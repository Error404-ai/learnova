const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
// const User = require("../models/User");
require('dotenv').config()

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://bhattanisha.me/api/auth/google/callback",
      passReqToCallback: true
    },
    function(request, accessToken, refreshToken, profile, done){
        done(null, profile);
    })
);

passport.serializeUser((user,done)=>{
    done(null,user);
});
passport.deserializeUser((user,done)=>{
    done(null,user);
});