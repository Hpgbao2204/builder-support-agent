const { Client, IntentsBitField } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const cheerio = require('cheerio');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// Function to get latest commits from GitHub
async function getLatestCommits() {
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const { data: commits } = await octokit.repos.listCommits({
    owner: 'w3f',
    repo: 'polkadot-wiki',
    per_page: 5,
  });

  const commitMessages = []

  for (const commit of commits) {
    const { data: commitDetails } = await octokit.repos.getCommit({
      owner: 'w3f',
      repo: 'polkadot-wiki',
      ref: commit.sha,
  });
  const files = commitDetails.files ? commitDetails.files.filter(file => file.filename.startsWith('docs/')) : [];

  if (files.length > 0) {
      commitMessages.push(
          `**Date:** ${commit.commit.author.date}\n**URL:** ${commit.html_url}\n**Changed files:**\n${files.map(file => `- ${file.filename} (modified)`).join('\n')}`
      );
  }
  }

  return commitMessages.join('\n\n');
}
// Function to get latest blog posts
async function getLatestBlogPosts() {

  console.log('🔍 Fetching the blog page...');
  try {
    const response = await axios.get('https://polkadot.network/blog');
    const $ = cheerio.load(response.data);

    const firstPost = $('h2 a').first();

    if (!firstPost.length) {
      console.log("❌ Không tìm thấy bài viết nào.");
      return null;
    }
    const title = firstPost.text().trim();
    let link = firstPost.attr('href');

    if (!link) {
      console.log("⚠️ Không tìm thấy đường link.");
      return null;
    }

    link = link.startsWith('http') ? link : `https://polkadot.network${link}`;
    return [{ title, link }];
  } catch (error) {
    console.error(`⚠️ Error fetching the blog page: ${error}`);
    return [];
  }
}

// Function ready discord
client.on('ready', () => {
  console.log(`✅ Bot is online and ready`);
});
// Interaction create
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'ask') {
    await interaction.deferReply();

    const userQuestion = interaction.options.getString('question');

    try {

      const TIME_LIMIT = 10 * 1000;

      const aiResponse = Promise.race([
        model.generateContent({
          contents: [
            { 
              role: 'user', 
              parts: [{ text: userQuestion }] 
            }
          ],
          generationConfig: 
          { 
            maxOutputTokens: 1000, 
            temperature: 0.7 
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), TIME_LIMIT))
      ]);

      const result = await aiResponse;
      const responseText = result.response.text();

      // Send the response to the Discord bot 
      await interaction.editReply({
        content: `**Question:** ${userQuestion}\n**Answer:**${responseText}`,
      });

      console.log(`User asked: ${userQuestion}`);
      console.log(`Gemini AI responded: ${responseText}`);
    } catch (error) {
      console.error(error);
      let errorMessage = "❌ An error occurred while processing your request.";
      if (error.message === "TIMEOUT") {
        errorMessage = "⏳ AI is taking too long to respond. Please try again later.";
      }

      await interaction.editReply({ content: errorMessage });
    }
  }

  if (commandName === 'noti') {
    await interaction.deferReply();

    const subCommand = interaction.options.getSubcommand();

    try {
      if (subCommand === 'commit') {
        const commits = await getLatestCommits();
        await interaction.editReply({ content: commits });
      } else if (subCommand === 'blog') {
        const blogPosts = await getLatestBlogPosts();
        if (blogPosts.length === 0) {
          await interaction.editReply({ content: '❌ No blog posts found.' });
          return;
        } else {
          const formattedPosts = blogPosts.map(post => `📰 **${post.title}**\n🔗 ${post.link}`).join("\n\n");
          console.log(formattedPosts);
          await interaction.editReply({ content: formattedPosts });
        }
      }
    } catch (error) {
      console.error(error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ An error occurred while fetching notifications.' });
      } else {
        await interaction.reply({ content: '❌ An error occurred while fetching notifications.', ephemeral: true });
      }
    }
  }
});

client.login(process.env.TOKEN);