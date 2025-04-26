const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');
const { playTextToSpeech, findMostPopulatedVoiceChannel } = require('./tts-logic');

dotenv.config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        // Set a new item in the Collection with the key as the command name and the value as the exported module
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Listen for interactions (slash commands)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }


    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

// Listen for messages (for pings)
client.on(Events.MessageCreate, async message => {
    console.log(`[MessageCreate] Received message: "${message.content}" from ${message.author.tag} (Bot: ${message.author.bot})`);

    // Ignore messages from bots (including self)
    if (message.author.bot) {
        return;
    }

    // Ensure client.user is ready before using its ID
    if (!client.user) {
        return;
    }

    // Check if the message starts with a ping to the bot
    const regexString = `^<@!?${client.user.id}>\\s+`; // Use double backslash \s -> literal \s for RegExp
    console.log(`[MessageCreate] Regex String: "${regexString}"`); // Log the string before RegExp constructor
    const pingRegex = new RegExp(regexString);
    console.log(`[MessageCreate] Checking content against regex: ${pingRegex}`);
    console.log(`[MessageCreate] Message content for test: "${message.content}"`); // Log content being tested
    const isPing = pingRegex.test(message.content);
    console.log(`[MessageCreate] Is ping? ${isPing}`);

    if (isPing) {
        const textToSpeak = message.content.replace(pingRegex, '').trim();
        if (!textToSpeak) return;

        const member = message.member;
        if (!member) return;
        const guild = message.guild;
        if (!guild) return; // Should not happen, but good check

        let voiceChannel = member.voice.channel;

        // If user is not in a channel, find the most populated one
        if (!voiceChannel) {
            console.log('[PingHandler] User not in VC, finding most populated...');
            voiceChannel = findMostPopulatedVoiceChannel(guild);
            if (!voiceChannel) {
                console.log('[PingHandler] No populated VC found, ignoring ping.');
                return; // Silently ignore if no one is in any VC
            }
            console.log(`[PingHandler] Found most populated channel: ${voiceChannel.name}`);
        }

        // Attempt to play the TTS
        try {
            const success = await playTextToSpeech(textToSpeak, voiceChannel, guild);
            if (success) {
                await message.react('🔊');
            } else {
                await message.react('❌');
            }
        } catch (error) {
            console.error('[MessageCreate] Error processing ping TTS:', error);
            await message.react('⚠️');
        }
    }
});


// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
