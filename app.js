const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const flash = require('express-flash');
const fs = require('fs').promises;

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// User data handling
const USERS_DIR = path.join(__dirname, 'public', 'users');

async function ensureUsersDirectory() {
    try {
        await fs.mkdir(USERS_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating users directory:', error);
    }
}

async function findUser(username) {
    try {
        const filePath = path.join(USERS_DIR, `${username}.json`);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

async function saveUser(userData) {
    await ensureUsersDirectory();
    const filePath = path.join(USERS_DIR, `${userData.username}.json`);
    await fs.writeFile(filePath, JSON.stringify(userData, null, 2));
}

// Passport configuration
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const user = await findUser(username);
        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
    } catch (error) {
        return done(error);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.username);
});

passport.deserializeUser(async (username, done) => {
    try {
        const user = await findUser(username);
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Make user data available to all views
app.use((req, res, next) => {
    res.locals.user = req.user;
    res.locals.messages = req.flash();
    next();
});

// Import routes
const telegramRoutes = require('./routes/telegram');
const telegramMonitorRoutes = require('./routes/telegram-monitor');
const knowledgeBaseRoutes = require('./routes/knowledge-base');

// Use routes
app.use('/telegram', telegramRoutes);
app.use('/telegram', telegramMonitorRoutes);
app.use('/knowledge-base', knowledgeBaseRoutes);

// Routes
app.get('/', ensureAuthenticated, (req, res) => {
    res.render('index', { 
        title: 'Home'
    });
});

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.render('login', { title: 'Login' });
});

app.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: true
}));

app.get('/signup', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.render('signup', { title: 'Sign Up' });
});

app.post('/signup', async (req, res) => {
    try {
        const { username, password, confirmPassword, dob } = req.body;
        
        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match');
            return res.redirect('/signup');
        }
        
        const existingUser = await findUser(username);
        if (existingUser) {
            req.flash('error', 'Username already exists');
            return res.redirect('/signup');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await saveUser({
            username,
            password: hashedPassword,
            dob,
            telegramConnected: false,
            createdAt: new Date()
        });

        req.flash('success', 'Registration successful. Please log in.');
        res.redirect('/login');
    } catch (error) {
        console.error('Signup error:', error);
        req.flash('error', 'Error during registration');
        res.redirect('/signup');
    }
});

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/login');
    });
});

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { 
        title: 'Forgot Password',
        step: 'username' 
    });
});

app.post('/forgot-password', async (req, res) => {
    const { username, dob, step } = req.body;
    
    if (step === 'username') {
        const user = await findUser(username);
        if (!user) {
            req.flash('error', 'Username not found');
            return res.redirect('/forgot-password');
        }
        return res.render('forgot-password', { 
            title: 'Forgot Password',
            step: 'dob', 
            username,
        });
    }
    
    if (step === 'dob') {
        const user = await findUser(username);
        // Format both dates to YYYY-MM-DD for comparison
        const userDob = new Date(user.dob).toISOString().split('T')[0];
        const inputDob = new Date(dob).toISOString().split('T')[0];
        
        if (userDob !== inputDob) {
            req.flash('error', 'Incorrect date of birth');
            return res.redirect('/forgot-password');
        }
        
        return res.render('forgot-password', { 
            title: 'Forgot Password',
            step: 'reset',
            username,
        });
    }

    if (step === 'reset') {
        try {
            const { username, newPassword, confirmPassword } = req.body;
            
            if (newPassword !== confirmPassword) {
                req.flash('error', 'Passwords do not match');
                return res.render('forgot-password', { 
                    title: 'Forgot Password',
                    step: 'reset',
                    username,
                });
            }

            const user = await findUser(username);
            if (!user) {
                req.flash('error', 'User not found');
                return res.redirect('/forgot-password');
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            user.password = hashedPassword;
            await saveUser(user);

            req.flash('success', 'Password reset successful. Please log in.');
            res.redirect('/login');
        } catch (error) {
            console.error('Password reset error:', error);
            req.flash('error', 'Error resetting password');
            res.redirect('/forgot-password');
        }
    }
});

// Protected route example
app.get('/profile', ensureAuthenticated, (req, res) => {
    res.render('profile', { title: 'Profile' });
});

// Custom 404 page
app.use((req, res, next) => {
    res.status(404).render('404', {
        title: '404 - Page Not Found',
        path: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('500', {
        title: '500 - Server Error',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// Create necessary directories at startup
async function initDirectories() {
    try {
        // Ensure users directory exists
        await ensureUsersDirectory();
        
        // Ensure data directory for message storage exists
        const dataDir = path.join(__dirname, 'public', 'data');
        await fs.mkdir(dataDir, { recursive: true });
        
        console.log('Directories initialized successfully');
    } catch (error) {
        console.error('Error initializing directories:', error);
    }
}

// Start server
app.listen(port, async () => {
    await initDirectories();
    console.log(`Server running at http://localhost:${port}`);
});