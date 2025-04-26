const ffmpeg = require('fluent-ffmpeg');
const fs = require('node:fs');
const path = require('node:path');
const { EndBehaviorType, getVoiceConnection } = require('@discordjs/voice');
const { PassThrough } = require('node:stream');

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)){
    fs.mkdirSync(recordingsDir);
    console.log(`Created directory: ${recordingsDir}`);
}

// Map to store active recording streams for users { guildId -> { userId -> { pcmStream, filename } } }
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

    const audioStream = connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual, // Keep recording until manually stopped
        },
    });

    // Use PassThrough to allow piping to ffmpeg later without file I/O issues initially
    const pcmStream = new PassThrough();
    audioStream.pipe(pcmStream);

    const timestamp = Date.now();
    // Store the PassThrough stream and intended final filename
    guildStreams.set(userId, { pcmStream, username, timestamp });

    console.log(`[Recorder] Started recording for user ${username} (${userId}) in guild ${guildId}`);

    // Handle stream errors
    audioStream.on('error', (err) => {
        console.error(`[Recorder] Error recording user ${userId}:`, err);
        stopUserRecording(guildId, userId); // Attempt cleanup on error
    });

     // It might be useful to log when the underlying Opus stream ends, though Manual behavior should prevent it ending early.
    audioStream.on('end', () => {
        console.log(`[Recorder] Opus stream ended for user ${userId}. Manual end behavior expected.`);
    });
}

async function stopUserRecording(guildId, userId) {
    const guildStreams = activeStreams.get(guildId);
    if (!guildStreams || !guildStreams.has(userId)) {
        console.log(`[Recorder] No active recording found for user ${userId} in guild ${guildId} to stop.`);
        return null; // No recording found for this user in this guild
    }

    const userData = guildStreams.get(userId);
    const { pcmStream, username, timestamp } = userData;
    const connection = getVoiceConnection(guildId);

    // Unsubscribe *before* destroying the stream if possible
    if (connection) {
        try {
            // Attempt to get the subscription and destroy it gracefully
             const subscription = connection.receiver.subscriptions.get(userId);
             if (subscription) {
                 subscription.destroy(); // This should end the Opus stream
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


    // Ensure the PassThrough stream ends so ffmpeg can process it
    pcmStream.end();

    guildStreams.delete(userId); // Remove user from active streams map

    const outputFilename = path.join(recordingsDir, `${guildId}-${username}-${timestamp}.mp3`);
    console.log(`[Recorder] Stopping recording for ${username} (${userId}). Saving to ${outputFilename}`);


    return new Promise((resolve, reject) => {
        ffmpeg(pcmStream)
            // Tell ffmpeg that the input is raw PCM data
            .inputFormat('s16le') // Signed 16-bit little-endian PCM
            .audioFrequency(48000) // Discord uses 48kHz
            .audioChannels(2) // Discord uses stereo
            .toFormat('mp3')
            .on('error', (err) => {
                console.error(`[Recorder] FFmpeg error for ${userId}:`, err);
                reject(err); // Reject the promise on error
            })
            .on('end', () => {
                console.log(`[Recorder] Finished processing MP3 for ${username} (${userId})`);
                resolve(outputFilename); // Resolve the promise with the filename on success
            })
            .save(outputFilename);
    });
}


async function stopGuildRecording(guildId) {
    const guildStreams = activeStreams.get(guildId);
    const connection = getVoiceConnection(guildId);

    if (!guildStreams || guildStreams.size === 0) {
        console.log(`[Recorder] No active recordings found for guild ${guildId} to stop.`);
         // Still try to disconnect if a connection exists but no streams were tracked
         if (connection) {
             console.log(`[Recorder] Destroying connection for guild ${guildId} as no streams were active.`);
             connection.destroy();
         }
        return []; // Return empty array if no streams
    }

    console.log(`[Recorder] Stopping all recordings for guild ${guildId}...`);
    const userIds = Array.from(guildStreams.keys());
    const stopPromises = userIds.map(userId => stopUserRecording(guildId, userId).catch(e => {
         console.error(`[Recorder] Failed to save recording for user ${userId}: ${e}`);
         return null; // Return null if a specific user's recording fails
    })); // Stop each user recording

    const savedFiles = (await Promise.all(stopPromises)).filter(file => file !== null); // Wait for all conversions and filter out failures

    // Clean up the guild entry from the map
    activeStreams.delete(guildId);

    // Destroy the connection *after* processing streams
    if (connection) {
        console.log(`[Recorder] Destroying connection for guild ${guildId} after stopping streams.`);
        connection.destroy();
    } else {
         console.warn(`[Recorder] No connection found for guild ${guildId} to destroy after stopping streams.`);
    }

    console.log(`[Recorder] Finished stopping recordings for guild ${guildId}. Saved files: ${savedFiles.join(', ')}`);
    return savedFiles; // Return list of successfully saved filenames
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
    // We might not need stopUserRecording exported if stopGuildRecording handles individuals
}; 