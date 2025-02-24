// First, install required packages:
// npm install passport passport-local express-session bcryptjs express-flash

// Update your app.js with these additions:
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const flash = require('express-flash');
const fs = require('fs').promises;
const path = require('path');

// Middleware setup
app.use(express.urlencoded({ extended: true }));
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

// Apply authentication to all routes except auth routes
app.use((req, res, next) => {
    const publicPaths = ['/login', '/signup', '/forgot-password', '/reset-password'];
    if (publicPaths.includes(req.path) || req.isAuthenticated()) {
        next();
    } else {
        res.redirect('/login');
    }
});

// Auth routes
app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash() });
});

app.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: true
}));

app.get('/signup', (req, res) => {
    res.render('signup', { messages: req.flash() });
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
    res.render('forgot-password', { step: 'username', messages: req.flash() });
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