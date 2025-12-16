const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('claude')
        .setDescription('Execute a command using Claude CLI')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message/prompt to send to Claude')
                .setRequired(true)),
    async execute(interaction) {
        // Defer the reply since Claude might take some time
        await interaction.deferReply();

        const message = interaction.options.getString('message');

        try {
            console.log(`[ClaudeCmd] Executing Claude CLI with message: "${message}"`);
            
            // Execute the claude command
            // Using shell escaping to safely pass the message
            const { stdout, stderr } = await execPromise(`claude "${message.replace(/"/g, '\\"')}"`);

            if (stderr) {
                console.error('[ClaudeCmd] Claude CLI stderr:', stderr);
            }

            // Discord has a 2000 character limit for messages
            let response = stdout.trim();
            
            if (!response) {
                response = 'Claude returned an empty response.';
            }

            // Truncate if too long
            if (response.length > 1900) {
                response = response.substring(0, 1900) + '\n... (truncated)';
            }

            await interaction.editReply({ content: `**Claude Response:**\n${response}` });

        } catch (error) {
            console.error('[ClaudeCmd] Error executing Claude CLI:', error);
            
            let errorMessage = 'An error occurred while executing the Claude command.';
            
            if (error.stderr) {
                errorMessage += `\n\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\``;
            } else if (error.message) {
                errorMessage += `\n\`\`\`\n${error.message.substring(0, 500)}\n\`\`\``;
            }
            
            await interaction.editReply({ content: errorMessage });
        }
    },
};
