const { SlashCommandBuilder } = require('discord.js');
const { playTextToSpeech, findMostPopulatedVoiceChannel } = require('../../tts-logic'); // Import both functions

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evan')
        .setDescription('Takes text input and plays it as speech in the user\'s voice channel.')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to speak')
                .setRequired(true)),
    async execute(interaction) {
        let voiceChannel = interaction.member?.voice?.channel;
        const guild = interaction.guild;

        if (!guild) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        // If user is not in a channel, find the most populated one
        if (!voiceChannel) {
            console.log('[EvanCmd] User not in VC, finding most populated...');
            voiceChannel = findMostPopulatedVoiceChannel(guild);
            if (!voiceChannel) {
                return interaction.reply({ content: 'You are not in a voice channel, and no other voice channels have users in them.', ephemeral: true });
            }
            console.log(`[EvanCmd] Found most populated channel: ${voiceChannel.name}`);
        }

        // Defer the reply
        await interaction.deferReply({ ephemeral: true });

        const text = interaction.options.getString('text');

        try {
            // Call the reusable TTS function with the determined voiceChannel
            const success = await playTextToSpeech(text, voiceChannel, guild);

            if (success) {
                await interaction.editReply({ content: 'Speech delivered!', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An error occurred while playing speech.', ephemeral: true });
            }

        } catch (error) {
            // This catch block might be less necessary now, but keep for safety
            console.error('Error in /evan command execute block:', error);
            try {
                 await interaction.editReply({ content: 'An unexpected error occurred executing the command.', ephemeral: true });
            } catch (editError) {
                 console.error("Failed to edit reply after command execution error:", editError);
            }
        }
    },
}; 