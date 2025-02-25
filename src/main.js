const { Client, IntentsBitField } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs.promises')

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

  const data = await fs.readFile('repos.json', 'utf8');
  const repoLinks = JSON.parse(data);

  const commitMessages = []; 

  for (const link of repoLinks) {
    const match = link.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) continue;

    const [_, owner, repo] = match;

    try {
      const { data: commits } = await octokit.repos.listCommits({
          owner,
          repo,
          per_page: 3,
      });
      for (const commit of commits) {
        const { data: commitDetails } = await octokit.repos.getCommit({
            owner,
            repo,
            ref: commit.sha,
        });
        const files = commitDetails.files
            ? commitDetails.files.filter(file => file.filename.startsWith('docs/'))
            : [];
        if (files.length > 0) {
            commitMessages.push(
                `**Repo:** ${repo}\n**Date:** ${commit.commit.author.date}\n**URL:** ${commit.html_url}\n**Changed files:**\n${files.map(file => `- ${file.filename} (modified)`).join('\n')}`
            );
        }
      }
    } catch (error) {
        console.error(`Error fetching commits for ${repo}:`, error);
    }
  }
  return commitMessages.join('\n\n'); // Return the commit messages
}

async function getLatestBlogPosts() {
  console.log('🔍 Fetching the blog pages...');
  try {
    const data = await fs.readFile('links.json', 'utf8');
    const blogLinks = JSON.parse(data);

    let blogPosts = [];

    for (const link of blogLinks) {
      try {
        const response = await axios.get(link);
        const $ = cheerio.load(response.data);
        const firstPost = $('h2 a').first(); 

        if (firstPost.length) {
          let postLink = firstPost.attr('href');
          postLink = postLink.startsWith('http') ? postLink : `${link}${postLink}`;
          blogPosts.push({ title: firstPost.text().trim(), link: postLink });
        }
      } catch (error) {
        console.error(`⚠️ Error fetching the blog page at ${link}: ${error}`);
      }
    }

    if (blogPosts.length === 0) {
      console.log("❌ No news.");
      return [];
    }

    return blogPosts;
  } catch (error) {
    console.error(`⚠️ Error reading links.json: ${error}`);
    return [];
  }
}

// Function ready discord
client.on('ready', () => {
  console.log(`✅ Bot is online and ready`);
});
// Interaction create
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  try {
    if (interaction.replied || interaction.deferred) {
      console.log('Interaction has already been acknowledged.');
      return;
    }

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
  } catch (error) {
    console.error('Error handling interaction:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
  }
});


client.login(process.env.TOKEN);