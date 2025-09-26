const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const User = require('../models/user.model');
const dotenv = require('dotenv');
dotenv.config();

// Store OTPs in memory (for demo)
const otpStore = {};

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ---------------- Registration ---------------- //
router.get('/register', (req, res) => {
    res.render('register', { oldInput: {}, errors: [] });
});

router.post('/register',
    body('email').trim().isEmail().withMessage("Enter a valid email"),
    body('password').trim().isLength({ min: 5 }).withMessage("Password must be at least 5 characters"),
    body('username').trim().isLength({ min: 3 }).withMessage("Name must be at least 3 characters"),
    body('phone').trim().isLength({ min: 10 }).withMessage("Phone must be at least 10 digits"),
    body('profession').trim().notEmpty().withMessage("Profession is required"),
    async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.render("register", {
                oldInput: req.body,
                errors: errors.array()
            });
        }

        const { username, email, password, phone, profession } = req.body;

        try {
            const userExists = await User.findOne({ $or: [{ email }, { phone }] });
            if (userExists) {
                return res.render("register", {
                    oldInput: req.body,
                    errors: [{ msg: "Email or phone already registered" }]
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            await User.create({
                username,
                email,
                password: hashedPassword,
                phone,
                profession
            });

            // ✅ Redirect to login page after success
            return res.redirect('/users/login');
        } catch (err) {
            console.error(err.message);
            res.render("register", {
                oldInput: req.body,
                errors: [{ msg: "Server error, please try again" }]
            });
        }
    }
);

// ---------------- GET Login ---------------- //
router.get('/login', (req, res) => {
    res.render('login', { oldInput: {}, errors: [] });
});



// ---------------- Login ---------------- //
router.post('/login',
    body('email').trim().isEmail().withMessage("Enter valid email"),
    body('password').trim().isLength({ min: 5 }).withMessage("Enter valid password"),
    async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: errors.array()[0].msg
            });
        }

        const { email, password } = req.body;

        try {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(400).json({
                    message: "Email or password is incorrect!"
                });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({
                    message: "Email or password is incorrect!"
                });
            }

            // Success: send message
            return res.status(200).json({
                message: "Login successful"
            });
        } catch (err) {
            console.error("Login error:", err);
            return res.status(500).json({
                message: "Server error, please try again"
            });
        }
    }
);

// ---------------- Home Page ---------------- //
router.get('/home', async (req, res) => {
  // No authentication required
  const users = await User.find({}, '-password');
  res.render('home', { users });
});

// ---------------- User APIs ---------------- //

// 1. List all users
router.get('/', async (req, res) => {
    try {
        const users = await User.find().select('-password'); // hide password
        res.status(200).json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// 2. Update user
router.put('/:id', async (req, res) => {
    const { username, phone, profession } = req.body;

    try {
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            { username, phone, profession },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'User updated successfully', user: updatedUser });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// 3. Delete user
router.delete('/:id', async (req, res) => {
    try {
        const deletedUser = await User.findByIdAndDelete(req.params.id);

        if (!deletedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// ---------------- Forgot Password ---------------- //

// Show forgot password form
router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { errors: [], oldInput: {} });
});

// Handle email submission, send OTP
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
        return res.render('forgot-password', {
            errors: [{ msg: "Email not found" }],
            oldInput: { email }
        });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email] = otp;

    // Send OTP via email
    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your OTP for Password Reset",
        text: `Your OTP is: ${otp}`
    });

    res.render('verify-otp', { email, errors: [] });
});

// Verify OTP and show reset form
router.post('/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (otpStore[email] !== otp) {
        return res.render('verify-otp', { email, errors: [{ msg: "Invalid OTP" }] });
    }
    res.render('reset-password', { email, errors: [] });
});

// Handle password reset
router.post('/reset-password', async (req, res) => {
    const { email, password } = req.body;
    if (!otpStore[email]) {
        return res.render('reset-password', { email, errors: [{ msg: "OTP expired or invalid" }] });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.updateOne({ email }, { password: hashedPassword });
    delete otpStore[email];
    res.redirect('/users/login');
});

// ---------------- Verify User ---------------- //

router.post('/verify-user', async (req, res) => {
    const { email, phone } = req.body;
    let user;
    if (email && phone) {
        user = await User.findOne({ email, phone });
    } else if (email) {
        user = await User.findOne({ email });
    } else if (phone) {
        user = await User.findOne({ phone });
    }
    let verifyMessage;
    if (user) {
        verifyMessage = "User verified!";
    } else {
        verifyMessage = "User not found or details incorrect.";
    }
    // Render home page with verification message
    const users = await User.find({}, '-password');
    res.render('home', { users, verifyMessage });
});

router.get('/verify-otp', (req, res) => {
    const email = req.query.email || '';
    res.render('verify-otp', { email, errors: [] });
});




module.exports = router;


