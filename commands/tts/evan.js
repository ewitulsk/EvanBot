const { SlashCommandBuilder } = require('discord.js');
const { playTextToSpeech } = require('../../tts-logic'); // Import the reusable function

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evan')
        .setDescription('Takes text input and plays it as speech in the user\'s voice channel.')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to speak')
                .setRequired(true)),
    async execute(interaction) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const text = interaction.options.getString('text');

        try {
            const success = await playTextToSpeech(text, voiceChannel, interaction.guild);

            if (success) {
                await interaction.editReply({ content: 'Speech delivered!', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'An error occurred while playing speech.', ephemeral: true });
            }

        } catch (error) {
            console.error('Error in /evan command execute block:', error);
            try {
                 await interaction.editReply({ content: 'An unexpected error occurred executing the command.', ephemeral: true });
            } catch (editError) {
                 console.error("Failed to edit reply after command execution error:", editError);
            }
        }
    },
}; 