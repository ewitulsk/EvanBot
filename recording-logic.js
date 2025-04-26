const ffmpeg = require('fluent-ffmpeg');
const fs = require('node:fs');
const path = require('node:path');
const { EndBehaviorType, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const os = require('node:os'); // Needed for temporary directory
const prism = require('prism-media'); // Correctly import prism-media, accessing opus Decoder via the main export

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)){
    fs.mkdirSync(recordingsDir);
    console.log(`Created directory: ${recordingsDir}`);
}

// Map to store active recording streams for users { guildId -> { userId -> { fileStream, tempFilename, username, timestamp, opusDecoder } } }
const activeStreams = new Map();

function startUserRecording(connection, userId, username) {
    const guildId = connection.joinConfig.guildId;
    if (!activeStreams.has(guildId)) {
        activeStreams.set(guildId, new Map());
    }
    const guildStreams = activeStreams.get(guildId);

    if (guildStreams.has(userId)) {
        console.log(`[Recorder] Already recording user ${userId} in guild ${guildId}`);
        return; // Already recording this user
    }

    // Subscribe to receive Opus packets instead of PCM
    const audioStream = connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual,
            mode: 'opus' // Request raw Opus data
        },
    });

    // Create an Opus decoder using the correct access path
    const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });

    const timestamp = Date.now();
    // Temporary file will store decoded PCM data
    const tempFilename = path.join(os.tmpdir(), `rec-${guildId}-${userId}-${timestamp}.pcm`);
    const fileStream = fs.createWriteStream(tempFilename);

    // Pipe: Discord Opus Stream -> Opus Decoder -> PCM File Stream
    audioStream.pipe(opusDecoder).pipe(fileStream);

    // Store the file stream and temporary filename
    guildStreams.set(userId, { fileStream, tempFilename, username, timestamp, opusDecoder }); // Store decoder to handle its errors too

    console.log(`[Recorder] Started recording user ${username} (${userId}) with Opus->PCM decoding. Temp file: ${tempFilename}`);

    // Handle stream errors
    audioStream.on('error', (err) => {
        console.error(`[Recorder] Error on Opus audioStream for ${userId}:`, err);
        // Clean up decoder and file stream
        if (opusDecoder && !opusDecoder.destroyed) opusDecoder.destroy();
        if (fileStream && !fileStream.destroyed) fileStream.end();
        stopUserRecording(guildId, userId).catch(e => console.error(`[Recorder] Error during cleanup after audioStream error for ${userId}:`, e));
    });

    opusDecoder.on('error', (err) => {
         console.error(`[Recorder] Error on Opus decoder for ${userId}:`, err);
         // Clean up file stream
         if (fileStream && !fileStream.destroyed) fileStream.end();
         stopUserRecording(guildId, userId).catch(e => console.error(`[Recorder] Error during cleanup after opusDecoder error for ${userId}:`, e));
    });

    fileStream.on('error', (err) => {
        console.error(`[Recorder] Error writing decoded PCM to temp file for ${userId}:`, err);
        // Attempt cleanup
         stopUserRecording(guildId, userId).catch(e => console.error(`[Recorder] Error during cleanup after fileStream error for ${userId}:`, e));
    });

    // audioStream 'end' logic remains largely the same, but now it signals the end of Opus packets
    audioStream.on('end', () => {
        console.log(`[Recorder] Opus source stream ended for user ${userId}. Decoder and file stream will be closed.`);
        // Ending the decoder should push any remaining data and then end the fileStream
        if (opusDecoder && !opusDecoder.destroyed) {
            opusDecoder.end();
        }
        // We might not need to explicitly end fileStream here if opusDecoder.end() handles it via piping.
        // Let's keep the explicit fileStream.end() for safety for now.
        if (fileStream && !fileStream.destroyed) {
            fileStream.end();
        }
    });
}

async function stopUserRecording(guildId, userId) {
    const guildStreams = activeStreams.get(guildId);
    if (!guildStreams || !guildStreams.has(userId)) {
        console.log(`[Recorder] No active recording found for user ${userId} in guild ${guildId} to stop.`);
        return null;
    }

    const userData = guildStreams.get(userId);
    // Retrieve fileStream, tempFilename, username, timestamp, opusDecoder
    const { fileStream, tempFilename, username, timestamp, opusDecoder } = userData;
    const connection = getVoiceConnection(guildId);

    console.log(`[Recorder] Stopping recording for user ${username} (${userId}). Temp file: ${tempFilename}`);

    // 1. Unsubscribe the receiver (stops Opus stream)
    if (connection) {
        try {
            const subscription = connection.receiver.subscriptions.get(userId);
            if (subscription) {
                subscription.destroy();
                console.log(`[Recorder] Unsubscribed receiver for user ${userId}`);
            } else {
                console.warn(`[Recorder] Could not find subscription for ${userId} to destroy.`);
            }
        } catch (err) {
            console.error(`[Recorder] Error trying to unsubscribe ${userId}:`, err);
        }
    } else {
        console.warn(`[Recorder] No connection found for guild ${guildId} during stopUserRecording.`);
    }

    // 2. Ensure decoder and file stream are properly ended
    // Destroying the subscription should trigger audioStream 'end', which should end the decoder/file stream.
    // However, we add explicit checks and cleanup here for robustness.
    if (opusDecoder && !opusDecoder.destroyed) {
        console.log(`[Recorder] Explicitly destroying Opus decoder for ${userId}.`);
        opusDecoder.destroy(); // Use destroy instead of end if we are forcefully stopping
    }
    // Wait for the file stream to finish writing before processing with ffmpeg
    await new Promise((resolve, reject) => {
        if (fileStream.destroyed) {
             console.log(`[Recorder] File stream for ${userId} already destroyed.`);
             resolve();
             return;
        }
        fileStream.on('finish', resolve);
        fileStream.on('error', (err) => {
            console.error(`[Recorder] Error closing file stream for ${userId}:`, err);
            reject(err); // Reject if closing fails
        });
        // Ensure fileStream is ended if it wasn't already by the decoder finishing/destroying
         if (!fileStream.writableEnded) {
             console.log(`[Recorder] Explicitly ending file stream for ${userId}.`);
             fileStream.end();
         }
    });

    // 3. Remove user from active streams map *before* async ffmpeg process
    guildStreams.delete(userId);
    if (guildStreams.size === 0) {
         // Clean up guild map entry if last user
         activeStreams.delete(guildId);
         console.log(`[Recorder] Removed guild ${guildId} from active streams map.`);
    }

    // 4. Process the temporary PCM file with ffmpeg
    const outputFilename = path.join(recordingsDir, `${guildId}-${username}-${timestamp}.mp3`);
    console.log(`[Recorder] Processing PCM temp file ${tempFilename} to ${outputFilename}`);

    return new Promise((resolve, reject) => {
        ffmpeg(tempFilename)
            // Tell ffmpeg the input is raw PCM, decoded by prism-media (usually s16le)
            .inputFormat('s16le') // Change back to s16le as prism-media likely outputs this
            .audioFrequency(48000)
            .audioChannels(2)
            .toFormat('mp3')
            .on('error', (err) => {
                console.error(`[Recorder] FFmpeg error processing ${tempFilename} for ${userId}:`, err);
                // Attempt to clean up temp file even on error
                fs.unlink(tempFilename, (unlinkErr) => {
                    if (unlinkErr) console.error(`[Recorder] Error deleting temp file ${tempFilename} after ffmpeg error:`, unlinkErr);
                });
                reject(err);
            })
            .on('end', () => {
                console.log(`[Recorder] Finished processing MP3 for ${username} (${userId}). Output: ${outputFilename}`);
                // Delete the temporary file after successful processing
                fs.unlink(tempFilename, (unlinkErr) => {
                    if (unlinkErr) console.error(`[Recorder] Error deleting temp file ${tempFilename} after success:`, unlinkErr);
                    else console.log(`[Recorder] Deleted temp file ${tempFilename}`);
                });
                resolve(outputFilename);
            })
            .save(outputFilename);
    });
}


async function stopGuildRecording(guildId) {
    const guildStreams = activeStreams.get(guildId);
    const connection = getVoiceConnection(guildId); // Get connection before potentially deleting map entry

    if (!guildStreams || guildStreams.size === 0) {
        console.log(`[Recorder] No active recordings found for guild ${guildId} to stop.`);
         if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
             console.log(`[Recorder] Destroying connection for guild ${guildId} as no streams were active.`);
             connection.destroy();
         }
        return [];
    }

    console.log(`[Recorder] Stopping all recordings for guild ${guildId}...`);
    const userIds = Array.from(guildStreams.keys()); // Get user IDs before map is modified by stopUserRecording

    // Important: Stop all user recordings (which now handles file stream closing and ffmpeg)
    const stopPromises = userIds.map(userId =>
        stopUserRecording(guildId, userId).catch(e => {
            console.error(`[Recorder] Failed to save recording for user ${userId}: ${e}`);
            // Attempt to clean up temp file if stopUserRecording failed before ffmpeg
            const userData = guildStreams?.get(userId); // Check if user data still exists
            if (userData?.tempFilename) {
                 fs.unlink(userData.tempFilename, (unlinkErr) => {
                     if (unlinkErr) console.error(`[Recorder] Error cleaning up temp file ${userData.tempFilename} for failed user ${userId}:`, unlinkErr);
                 });
            }
             // Ensure user is removed from map even on failure
             if (guildStreams?.has(userId)) {
                 guildStreams.delete(userId);
             }
            return null; // Indicate failure for this user
        })
    );

    const savedFiles = (await Promise.all(stopPromises)).filter(file => file !== null);

    // Map entry for the guild should be removed by the last call to stopUserRecording
    // but double-check here.
    if (activeStreams.has(guildId)) {
         console.warn(`[Recorder] Guild entry ${guildId} still exists in activeStreams map after stopping all users. Removing.`);
         activeStreams.delete(guildId);
    }

    // Destroy the connection *after* attempting to stop all streams
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        console.log(`[Recorder] Destroying connection for guild ${guildId} after stopping streams.`);
        connection.destroy();
    } else if (!connection) {
         console.warn(`[Recorder] No connection found for guild ${guildId} to destroy after stopping streams.`);
    }

    console.log(`[Recorder] Finished stopping recordings for guild ${guildId}. Saved files: ${savedFiles.length > 0 ? savedFiles.join(', ') : 'None'}`);
    return savedFiles;
}

// Function to check if recording is active for a guild
function isGuildRecording(guildId) {
    const guildStreams = activeStreams.get(guildId);
    return !!guildStreams && guildStreams.size > 0;
}

module.exports = {
    startUserRecording,
    stopGuildRecording,
    isGuildRecording,
    // stopUserRecording is now more complex and tightly coupled, maybe keep it internal?
    // Exporting it might be fine if needed elsewhere, but consider implications.
}; 