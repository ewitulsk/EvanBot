const discord = require('discord.js');
console.log('discord.js imported:', typeof discord, Object.keys(discord).includes('InteractionCallbackDataFlags')); // Log type and if key exists
console.log('InteractionCallbackDataFlags:', discord.InteractionCallbackDataFlags); // Log the flag object itself
const { SlashCommandBuilder } = discord;
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, StreamType, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const { ElevenLabsClient } = require("elevenlabs");
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const elevenlabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evan')
        .setDescription('Takes text input and plays it as speech in the user\'s voice channel.')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to speak')
                .setRequired(true)),
    async execute(interaction) {
        let connection = null; // Declare connection here

        // Check if the command is used in the target channel
        if (interaction.channelId !== process.env.CHANNEL_ID) {
            return interaction.reply({ content: `This command can only be used in the designated channel.`, ephemeral: true });
        }

        // Check if the user is in a voice channel
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command.', ephemeral: true });
        }

        // Defer the reply as TTS and joining might take time
        await interaction.deferReply({ ephemeral: true });

        const text = interaction.options.getString('text');
        const audioFileName = `audio_${Date.now()}.mp3`;
        const audioFilePath = path.join(__dirname, '..', '..', audioFileName); // Store in the root directory

        try {
            // Generate audio using ElevenLabs
            const audio = await elevenlabs.generate({
                voice: "Evan Witulski", // You can change the voice here
                model_id: "eleven_multilingual_v2", // Or another model
                text: text
            });

            const fileStream = fs.createWriteStream(audioFilePath);
            audio.pipe(fileStream);

            await new Promise((resolve, reject) => {
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
            });

            // Join the voice channel
            connection = joinVoiceChannel({ // Assign to the outer scope variable
                channelId: voiceChannel.id,
                guildId: interaction.guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false, // Bot will not be deafened
                selfMute: false // Bot will not be muted
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

            // Clean up: destroy connection and delete audio file
            connection.destroy();
            fs.unlinkSync(audioFilePath);

            await interaction.editReply({ content: 'Speech delivered!', ephemeral: true });

        } catch (error) {
            console.error('Error in /evan command:', error);
            // Attempt to clean up connection and file if they exist
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
            }
            if (fs.existsSync(audioFilePath)) {
                fs.unlinkSync(audioFilePath);
            }
            // Use editReply if deferred
            try {
                await interaction.editReply({ content: 'An error occurred while processing your request.', ephemeral: true });
            } catch (editError) {
                console.error("Failed to edit reply after error:", editError);
                 // As a fallback, try to follow up if possible (might fail if interaction expired)
                try {
                    await interaction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
                } catch (followUpError) {
                    console.error("Failed to follow up after error:", followUpError);
                }
            }
        }
    },
}; 