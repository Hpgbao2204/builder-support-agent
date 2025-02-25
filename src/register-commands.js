// register-commands.js
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const commands = [
  {
    name: 'ask',
    description: 'Ask a question to the bot.',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'question',
        description: 'Ask a question to the bot.',
        required: true,
        min_length: 3,
        max_length: 2000,
      },
    ],
  },
  {
    name: 'noti',
    description: 'Get notification',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'commit',
        description: 'Notification latest commit',
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'blog',
        description: 'Notification latest blog post',
      }
    ],
  }
];

async function registerCommands() {
  // Validate environment variables
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('❌ Missing required environment variables. Please check your .env file');
    console.error('Required variables: TOKEN, CLIENT_ID, GUILD_ID');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('🔄 Started refreshing slash (/) commands...');
    
    // For guild-specific commands (faster for development)
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    
    console.log('✅ Successfully registered guild commands!');
    
    // Uncomment to register global commands (takes up to an hour to propagate)
    // await rest.put(
    //   Routes.applicationCommands(CLIENT_ID),
    //   { body: commands }
    // );
    // console.log('✅ Successfully registered global commands!');
    
  } catch (error) {
    console.error('❌ Error registering commands:');
    console.error(error);
    process.exit(1);
  }
}

// Execute the registration
registerCommands();

// Export commands for potential use in other files
module.exports = { commands };