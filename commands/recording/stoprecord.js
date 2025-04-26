const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const { stopGuildRecording, isGuildRecording } = require('../../recording-logic'); // Import recording logic
const path = require('node:path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stoprecord')
        .setDescription('Stops recording audio and saves the files.'),
    async execute(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        const connection = getVoiceConnection(guild.id);

        // Use isGuildRecording to check our recorder state
        if (!isGuildRecording(guild.id)) {
            // If not recording, but a connection exists, offer to clean it up.
            if (connection) {
                 console.log('[StopRecordCmd] No active recording, but connection exists. Leaving channel.');
                 connection.destroy();
                 return interaction.reply({ content: 'No active recording was found, but I left the voice channel.', ephemeral: true });
            } else {
                 // No recording and no connection.
                 return interaction.reply({ content: 'I am not currently recording in this server.', ephemeral: true });
            }
        }

        // If we reach here, isGuildRecording(guild.id) is true.
        await interaction.deferReply({ ephemeral: false }); // Make the reply visible

        try {
            console.log(`[StopRecordCmd] Attempting to stop recording for guild ${guild.id}`);
            const savedFiles = await stopGuildRecording(guild.id); // This function now handles connection.destroy()
            console.log(`[StopRecordCmd] stopGuildRecording completed for guild ${guild.id}. Files saved: ${savedFiles.length}`);

            if (savedFiles.length > 0) {
                await interaction.editReply(`Finished Command`);
                // Optionally list files, but this might get long:
                // const fileBasenames = savedFiles.map(f => path.basename(f));
                // await interaction.followUp({ content: `Files saved:\n- ${fileBasenames.join('\n- ')}`, ephemeral: true });
            } else {
                await interaction.editReply('Finished Command');
            }

        } catch (error) {
            console.error('[StopRecordCmd] Error stopping recording:', error);
            // stopGuildRecording should handle cleanup even on error, so just inform the user.
            await interaction.editReply({ content: 'Error With Command', ephemeral: true });
        }
    },
};