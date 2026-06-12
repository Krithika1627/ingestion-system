require('dotenv').config();

function auth(req, res, next) {
    const apiKey = req.header("X-API-Key");

    if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
        return res.status(401).json({
            message: "Unauthorized"
        });
    }

    next();
}

module.exports = auth;