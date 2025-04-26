const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const { startUserRecording, isGuildRecording } = require('../../recording-logic'); // Import recording logic

module.exports = {
    data: new SlashCommandBuilder()
        .setName('record')
        .setDescription('Starts recording audio in your current voice channel.'),
    async execute(interaction) {
        const member = interaction.member;
        const guild = interaction.guild;
        const voiceChannel = member?.voice?.channel;

        if (!guild) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        if (!voiceChannel) {
            return interaction.reply({ content: 'You must be in a voice channel to start recording.', ephemeral: true });
        }

        if (isGuildRecording(guild.id)) {
             return interaction.reply({ content: 'I am already recording in this server.', ephemeral: true });
        }

        // Check if already connected (e.g., due to a previous failed stop)
        let connection = getVoiceConnection(guild.id);

        if (connection && connection.joinConfig.channelId !== voiceChannel.id) {
            // Connected to a *different* channel, which shouldn't happen if isGuildRecording is false
            // Best to destroy the old one and create a new one
            console.warn(`[RecordCmd] Found connection to a different channel (${connection.joinConfig.channelId}) while not recording. Destroying.`);
            connection.destroy();
            connection = null; // Ensure we create a new one
        } else if (connection) {
            // Already connected to the correct channel, likely a leftover connection
            console.log(`[RecordCmd] Reusing existing connection to channel ${voiceChannel.name}`);
        }

        await interaction.deferReply();

        try {
            // Join the channel if not already connected
            if (!connection) {
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: false, // Must be false to receive audio
                    selfMute: false,
                });
                console.log(`[RecordCmd] Joining channel ${voiceChannel.name}`);

                // Wait for the connection to be ready
                await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
                console.log(`[RecordCmd] Connection Ready for ${voiceChannel.name}`);
            } else if (connection.state.status !== VoiceConnectionStatus.Ready) {
                 // If connection exists but isn't ready, wait for it
                 console.log(`[RecordCmd] Existing connection not ready, waiting...`);
                 await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
                 console.log(`[RecordCmd] Existing connection became Ready`);
            }

            // --- Start recording logic --- 
            
            // Add listener for new users joining the channel *after* recording starts
            connection.receiver.speaking.on('start', (userId) => {
                // Need to fetch the user/member object to get the username
                 guild.members.fetch(userId).then(member => {
                     if (member) {
                         console.log(`[RecordCmd] Detected user ${member.user.username} speaking. Attempting to record.`);
                         startUserRecording(connection, userId, member.user.username);
                     } else {
                         console.warn(`[RecordCmd] Could not fetch member for speaking user ID ${userId}`);
                     }
                 }).catch(err => console.error(`[RecordCmd] Error fetching member for ${userId}:`, err));
            });
            
            // Record users already in the channel when the command is run
            console.log(`[RecordCmd] Starting recording for users already in channel: ${voiceChannel.name}`);
            voiceChannel.members.forEach(member => {
                if (!member.user.bot) { // Don't record bots
                    console.log(`[RecordCmd] Recording existing user: ${member.user.username} (${member.id})`);
                    startUserRecording(connection, member.id, member.user.username);
                } else {
                    console.log(`[RecordCmd] Skipping bot user: ${member.user.username}`);
                }
            });
            
            await interaction.editReply({ content: `Command Started.` });

        } catch (error) {
            console.error('[RecordCmd] Error starting recording:', error);
            // Clean up connection if we created it and failed
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
                const currentGuildRecording = isGuildRecording(guild.id); // Check state *before* destroying
                 if (!currentGuildRecording) {
                    connection.destroy();
                    console.log("[RecordCmd] Destroyed connection due to error during startup.")
                 } else {
                     console.log("[RecordCmd] Recording appears active despite error, not destroying connection.")
                 }
            }
            await interaction.editReply({ content: 'Failed to start run command. Please check permissions and try again.', flags: [1 << 6] /* MessageFlags.Ephemeral */ });
        }
    },
}; 