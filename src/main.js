const { Client, IntentsBitField, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs.promises')
const path = require('path');

// Initialize environment and configurations
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DISCORD_TOKEN = process.env.TOKEN;
const AI_TIMEOUT = 15 * 1000; // 15 seconds timeout
const MAX_OUTPUT_TOKENS = 1500;

// Initialize AI client
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

// Initialize Discord client
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// File paths
const CONFIG_DIR = path.join(__dirname, '.');
const REPOS_FILE = path.join(CONFIG_DIR, 'repos.json');
const LINKS_FILE = path.join(CONFIG_DIR, 'links.json');

/**
 * Get latest commits from GitHub repos that modified docs
 * @returns {Promise<string>} Formatted commit messages
 */
async function getLatestCommits() {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    const data = await fs.readFile(REPOS_FILE, 'utf8');
    const repoLinks = JSON.parse(data);

    if (!repoLinks || !Array.isArray(repoLinks) || repoLinks.length === 0) {
      return "No repositories configured in repos.json";
    }

    const commitMessages = await Promise.all(repoLinks.map(async (link) => {
      const match = link.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!match) return null;

      const [_, owner, repo] = match;
      try {
        const { data: commits } = await octokit.repos.listCommits({
          owner,
          repo,
          per_page: 3,
        });

        const docCommits = await Promise.all(commits.map(async (commit) => {
          try {
            const { data: commitDetails } = await octokit.repos.getCommit({
              owner,
              repo,
              ref: commit.sha,
            });
            
            const docFiles = commitDetails.files?.filter(file => file.filename.startsWith('docs/')) || [];
            
            if (docFiles.length > 0) {
              return {
                repo,
                date: commit.commit.author.date,
                url: commit.html_url,
                files: docFiles.map(file => `- ${file.filename} (${file.status})`)
              };
            }
          } catch (error) {
            console.error(`Error fetching commit details for ${repo}/${commit.sha}:`, error);
          }
          return null;
        }));

        return docCommits.filter(Boolean);
      } catch (error) {
        console.error(`Error fetching commits for ${repo}:`, error);
        return null;
      }
    }));

    // Flatten and format commit messages
    const flattenedCommits = commitMessages
      .flat()
      .filter(Boolean)
      .flat()
      .filter(Boolean);

    if (flattenedCommits.length === 0) {
      return "No documentation changes found in recent commits.";
    }

    return flattenedCommits
      .map(commit => 
        `**Repo:** ${commit.repo}\n**Date:** ${commit.date}\n**URL:** ${commit.url}\n**Changed files:**\n${commit.files.join('\n')}`)
      .join('\n\n');
  } catch (error) {
    console.error("Error in getLatestCommits:", error);
    throw new Error("Failed to fetch GitHub commits. Please check your configuration and token.");
  }
}

/**
 * Get latest blog posts from configured sites
 * @returns {Promise<Array>} Array of blog post objects
 */
async function getLatestBlogPosts() {
  console.log('🔍 Fetching the blog pages...');
  try {
    const data = await fs.readFile(LINKS_FILE, 'utf8');
    const blogLinks = JSON.parse(data);

    if (!blogLinks || !Array.isArray(blogLinks) || blogLinks.length === 0) {
      console.log("No blog links configured in links.json");
      return [];
    }

    const blogPosts = await Promise.all(blogLinks.map(async (link) => {
      try {
        const response = await axios.get(link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        });
        
        const $ = cheerio.load(response.data);
        const firstPost = $('h2 a, .post-title a, .entry-title a').first(); 

        if (firstPost.length) {
          let postLink = firstPost.attr('href');
          // Handle relative URLs
          postLink = postLink.startsWith('http') ? postLink : 
            postLink.startsWith('/') ? new URL(postLink, link).href : 
            `${link}${postLink}`;
          return { 
            title: firstPost.text().trim(), 
            link: postLink,
            source: new URL(link).hostname
          };
        }
        return null;
      } catch (error) {
        console.error(`⚠️ Error fetching blog at ${link}:`, error.message);
        return null;
      }
    }));

    return blogPosts.filter(Boolean);
  } catch (error) {
    console.error(`⚠️ Error reading links.json:`, error);
    throw new Error("Failed to read blog configuration.");
  }
}

/**
 * Ask the Gemini AI a question
 * @param {string} question The user's question
 * @returns {Promise<string>} AI's response
 */
async function askGemini(question) {
  try {
    const aiResponse = await Promise.race([
      model.generateContent({
        contents: [
          { 
            role: 'user', 
            parts: [{ text: question }] 
          }
        ],
        generationConfig: { 
          maxOutputTokens: MAX_OUTPUT_TOKENS, 
          temperature: 0.7 
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), AI_TIMEOUT)
      )
    ]);

    return aiResponse.response.text();
  } catch (error) {
    if (error.message === "TIMEOUT") {
      throw new Error("TIMEOUT");
    }
    console.error("Gemini API error:", error);
    throw new Error("AI service error");
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
    if (commandName === 'ask') {
      await handleAskCommand(interaction);
    } else if (commandName === 'noti') {
      await handleNotiCommand(interaction);
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    const errorMessage = 'There was an error while executing this command!';
    
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: errorMessage });
    } else if (!interaction.replied) {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

/**
 * Handle the /ask command
 * @param {Interaction} interaction The Discord interaction
 */
async function handleAskCommand(interaction) {
  await interaction.deferReply();
  const userQuestion = interaction.options.getString('question');
  try {
    const responseText = await askGemini(userQuestion);
    console.log(`AI response: ${responseText}`);
    // Create a rich embed for better formatting
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('AI Response')
      .setDescription(`**Question:** ${userQuestion}`)
      .addFields({ name: 'Answer', value: responseText.length > 1024 ? 
        responseText.substring(0, 1021) + '...' : responseText })
      .setFooter({ text: 'Powered by Gemini AI' })
      .setTimestamp();
    
    console.log("pass embed");
    await interaction.editReply({ embeds: [embed] });

    console.log(`User ${interaction.user.tag} asked: ${userQuestion}`);
  } catch (error) {
    let errorMessage = "❌ An error occurred while processing your request.";
    if (error.message === "TIMEOUT") {
      errorMessage = "⏳ AI is taking too long to respond. Please try again later.";
    }
    console.log(error);
    await interaction.editReply({ content: errorMessage });
  }
}

/**
 * Handle the /noti command
 * @param {Interaction} interaction The Discord interaction
 */
async function handleNotiCommand(interaction) {
  await interaction.deferReply();
  const subCommand = interaction.options.getSubcommand();

  try {
    if (subCommand === 'commit') {
      const commits = await getLatestCommits();
      
      // Split long messages if needed (Discord has 2000 char limit)
      if (commits.length > 1900) {
        const chunks = [];
        for (let i = 0; i < commits.length; i += 1900) {
          chunks.push(commits.substring(i, i + 1900));
        }
        
        await interaction.editReply({ content: chunks[0] });
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i] });
        }
      } else {
        await interaction.editReply({ content: commits });
      }
    } else if (subCommand === 'blog') {
      const blogPosts = await getLatestBlogPosts();
      
      if (blogPosts.length === 0) {
        await interaction.editReply({ content: '❌ No blog posts found.' });
        return;
      }
      
      // Create an embed for better presentation
      const embed = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle('Latest Blog Posts')
        .setDescription('Recent posts from configured blogs')
        .setTimestamp();
        
      blogPosts.forEach(post => {
        embed.addFields({
          name: post.title,
          value: `[Read on ${post.source}](${post.link})`
        });
      });
      
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Noti command error:", error);
    await interaction.editReply({ 
      content: `❌ Error: ${error.message || 'An error occurred while fetching notifications.'}` 
    });
  }
}

// Start the bot
client.login(DISCORD_TOKEN)
  .catch(error => {
    console.error("Failed to login to Discord:", error);
    process.exit(1);
  });