// register-commands.js
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

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

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Started refreshing SLASH (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log('Successfully reloaded SLASH (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();