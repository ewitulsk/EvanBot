const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, StreamType, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const { ElevenLabsClient } = require("elevenlabs");
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { ChannelType } = require('discord.js');

dotenv.config();

const elevenlabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

async function playTextToSpeech(text, voiceChannel, guild) {
    if (!voiceChannel || !guild || !text) {
        console.error('Invalid parameters passed to playTextToSpeech');
        return false; // Indicate failure
    }

    const audioFileName = `audio_${Date.now()}.mp3`;
    const audioFilePath = path.join(__dirname, audioFileName); // Store in the root directory relative to this file
    let connection = null;

    try {
        // Generate audio using ElevenLabs
        const audio = await elevenlabs.generate({
            voice: "Evan Witulski", // You can change the voice here or make it configurable
            model_id: "eleven_multilingual_v2",
            text: text
        });

        const fileStream = fs.createWriteStream(audioFilePath);
        audio.pipe(fileStream);

        await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });

        // Join the voice channel
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        // Wait for the connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, 30e3);

        // Create audio player and resource
        const player = createAudioPlayer();
        const resource = createAudioResource(audioFilePath, {
            inputType: StreamType.Arbitrary,
        });

        // Subscribe the connection to the player
        connection.subscribe(player);

        // Play the audio
        player.play(resource);

        // Wait for the player to finish playing
        await entersState(player, AudioPlayerStatus.Idle, 60e3); // Wait up to 60 seconds

        return true; // Indicate success

    } catch (error) {
        console.error('Error in playTextToSpeech function:', error);
        return false; // Indicate failure
    } finally {
        // Clean up: destroy connection and delete audio file
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
        if (fs.existsSync(audioFilePath)) {
            try {
                fs.unlinkSync(audioFilePath);
            } catch (unlinkError) {
                console.error("Error deleting audio file:", unlinkError);
            }
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