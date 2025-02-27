const express = require('express');
const router = express.Router();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const readline = require('readline');

// Load environment variables
dotenv.config();

// Create readline interface for terminal input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify the readline question
const question = (text) => new Promise((resolve) => {
    rl.question(text, resolve);
});

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Render Telegram connect page
router.get('/connect', ensureAuthenticated, (req, res) => {
    // Check if already connected
    const telegramConnected = process.env.TELEGRAM_SESSION && process.env.TELEGRAM_SESSION !== '';
    
    res.render('telegram-connect', {
        title: 'Connect Telegram',
        user: req.user,
        telegramConnected
    });
});

// Handle phone number submission and start Telegram authentication directly
router.post('/connect/phone', ensureAuthenticated, async (req, res) => {
    try {
        // We'll use the phone number from .env file
        const phone = process.env.TELEGRAM_PHONE;
        
        if (!phone) {
            req.flash('error', 'Phone number not configured in .env file');
            return res.redirect('/telegram/connect');
        }
        
        const apiId = parseInt(process.env.TELEGRAM_API_ID);
        const apiHash = process.env.TELEGRAM_API_HASH;
        
        if (!apiId || !apiHash) {
            req.flash('error', 'Telegram API credentials not configured');
            return res.redirect('/telegram/connect');
        }
        
        // Start the Telegram client
        console.log(`Starting Telegram authentication for phone: ${phone}`);
        const stringSession = new StringSession('');
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
        });
        
        await client.start({
            phoneNumber: phone,
            password: async () => {
                const password = await question('Please enter your 2FA password (if required): ');
                return password;
            },
            phoneCode: async () => {
                // This will prompt in the terminal for the verification code
                const code = await question('Please enter the verification code sent to your Telegram: ');
                console.log('Code received:', code);
                return code;
            },
            onError: (err) => {
                console.error('Telegram authentication error:', err);
                throw err;
            },
        });
        
        // Save the session string
        const session = client.session.save();
        await updateEnvFile('TELEGRAM_SESSION', session);
        console.log('Telegram session saved successfully!');
        
        // Update user data to indicate Telegram is connected
        req.user.telegramConnected = true;
        const filePath = path.join(__dirname, '..', 'public', 'users', `${req.user.username}.json`);
        const userData = JSON.parse(await fs.readFile(filePath, 'utf8'));
        userData.telegramConnected = true;
        await fs.writeFile(filePath, JSON.stringify(userData, null, 2));
        
        req.flash('success', 'Telegram connected successfully!');
        res.redirect('/profile');
        
    } catch (error) {
        console.error('Telegram authentication error:', error);
        req.flash('error', 'Failed to connect Telegram: ' + error.message);
        res.redirect('/telegram/connect');
    }
});

// Disconnect Telegram
router.post('/disconnect', ensureAuthenticated, async (req, res) => {
    try {
        await updateEnvFile('TELEGRAM_SESSION', '');
        
        // Update user data
        const filePath = path.join(__dirname, '..', 'public', 'users', `${req.user.username}.json`);
        const userData = JSON.parse(await fs.readFile(filePath, 'utf8'));
        userData.telegramConnected = false;
        await fs.writeFile(filePath, JSON.stringify(userData, null, 2));
        
        req.flash('success', 'Telegram disconnected successfully');
        res.redirect('/profile');
    } catch (error) {
        console.error('Error disconnecting Telegram:', error);
        req.flash('error', 'Failed to disconnect Telegram');
        res.redirect('/profile');
    }
});

// Helper function to update .env file
async function updateEnvFile(key, value) {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent;
    
    try {
        envContent = await fs.readFile(envPath, 'utf8');
    } catch (error) {
        // If .env doesn't exist, create a new one
        envContent = '';
    }
    
    // Check if the key already exists in the .env file
    const regex = new RegExp(`^${key}=.*$`, 'm');
    
    if (regex.test(envContent)) {
        // Replace existing value
        envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
        // Add new key-value pair
        envContent += `\n${key}=${value}`;
    }
    
    await fs.writeFile(envPath, envContent);
    
    // Update process.env
    process.env[key] = value;
}

module.exports = router;