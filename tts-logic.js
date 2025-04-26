const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, StreamType, VoiceConnectionStatus, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { ElevenLabsClient } = require("elevenlabs");
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { ChannelType } = require('discord.js');
const { isGuildRecording } = require('./recording-logic'); // Import check for active recording

dotenv.config();

const elevenlabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

async function playTextToSpeech(text, voiceChannel, guild) {
    if (!voiceChannel || !guild || !text) {
        console.error('[TTS] Invalid parameters passed to playTextToSpeech');
        return false; // Indicate failure
    }

    const guildId = guild.id;
    const audioFileName = `audio_${Date.now()}.mp3`;
    const audioFilePath = path.join(__dirname, audioFileName);
    let connection = getVoiceConnection(guildId);
    let connectionCreated = false;

    try {
        // Generate audio using ElevenLabs
        console.log(`[TTS] Generating audio for text: "${text.substring(0, 50)}..."`);
        const audio = await elevenlabs.generate({
            voice: "Evan Witulski", // You can change the voice here or make it configurable
            model_id: "eleven_multilingual_v2",
            text: text
        });

        const fileStream = fs.createWriteStream(audioFilePath);
        audio.pipe(fileStream);

        await new Promise((resolve, reject) => {
            fileStream.on('finish', () => {
                console.log(`[TTS] Audio file saved: ${audioFileName}`);
                resolve();
            });
            fileStream.on('error', (err) => {
                 console.error(`[TTS] Error saving audio file: ${err}`);
                 reject(err);
            });
        });

        // Join the voice channel if not already connected or in a different channel
        if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
            if (connection) {
                 // If connected to a different channel, destroy the old connection first.
                 // This scenario might indicate a state mismatch, but we'll handle it by reconnecting.
                 console.warn(`[TTS] Connection exists for guild ${guildId} but in different channel (${connection.joinConfig.channelId}). Reconnecting to ${voiceChannel.id}.`);
                 connection.destroy();
            }
            console.log(`[TTS] Joining channel ${voiceChannel.name} (${voiceChannel.id})`);
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false, // Need to hear for TTS, potentially change if only recording
                selfMute: false
            });
            connectionCreated = true; // Mark that we created this connection in this function call
            // Wait for the connection to be ready
            console.log('[TTS] Waiting for connection to be ready...');
            await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
            console.log('[TTS] Connection Ready.');
        } else {
             console.log(`[TTS] Reusing existing connection to channel ${voiceChannel.name}`);
              // Ensure the reused connection is actually ready
              if (connection.state.status !== VoiceConnectionStatus.Ready) {
                 console.log('[TTS] Existing connection not ready, waiting...');
                 await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
                 console.log('[TTS] Existing connection became Ready.');
             }
        }

        // Create audio player and resource
        const player = createAudioPlayer();
        const resource = createAudioResource(audioFilePath, {
            inputType: StreamType.Arbitrary,
        });

        // Subscribe the connection to the player
        const subscription = connection.subscribe(player);

        // Play the audio
        console.log('[TTS] Playing audio...');
        player.play(resource);

        // Wait for the player to finish playing
        await entersState(player, AudioPlayerStatus.Idle, 60e3); // Wait up to 60 seconds
        console.log('[TTS] Audio finished playing.');

        // Unsubscribe the player after playback finishes to allow other subscriptions (like recording)
        if (subscription) {
            subscription.unsubscribe();
            console.log('[TTS] Unsubscribed player from connection.');
        }

        return true; // Indicate success

    } catch (error) {
        console.error('[TTS] Error in playTextToSpeech function:', error);
        return false; // Indicate failure
    } finally {
        // Clean up: delete audio file
        if (fs.existsSync(audioFilePath)) {
            try {
                fs.unlinkSync(audioFilePath);
                 console.log(`[TTS] Deleted temporary audio file: ${audioFileName}`);
            } catch (unlinkError) {
                console.error("[TTS] Error deleting audio file:", unlinkError);
            }
        }

         // Destroy connection ONLY if we created it in *this function call*
         // AND if no recording is currently active for the guild.
         const recordingActive = isGuildRecording(guildId);
         if (connectionCreated && !recordingActive && connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
             console.log(`[TTS] Destroying connection created by this TTS call as no recording is active.`);
             connection.destroy();
         } else if (connectionCreated && recordingActive) {
              console.log(`[TTS] Not destroying connection created by TTS because a recording is active.`);
         } else if (!connectionCreated && connection) {
             console.log(`[TTS] Not destroying connection as it was pre-existing (likely for recording).`);
         }
    }
}

function findMostPopulatedVoiceChannel(guild) {
    if (!guild) return null;

    let mostPopulatedChannel = null;
    let maxMembers = 0;

    // Iterate over all channels in the guild cache
    guild.channels.cache.forEach(channel => {
        // Check if it's a voice channel and has members
        if (channel.type === ChannelType.GuildVoice && channel.members.size > 0) {
            if (channel.members.size > maxMembers) {
                maxMembers = channel.members.size;
                mostPopulatedChannel = channel;
            }
        }
    });

    console.log(`[findMostPopulated] Found channel: ${mostPopulatedChannel?.name} with ${maxMembers} members`);
    return mostPopulatedChannel; // Returns the channel object or null
}

module.exports = { playTextToSpeech, findMostPopulatedVoiceChannel }; 