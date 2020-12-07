const Pool = require('pg').Pool;

const pool = new Pool({
    host: process.env.HOSTNAME,
    database: process.env.DATABASE,
    port: process.env.DB_PORT,
    user: process.env.USERNAME,
    password: process.env.PASSWORD
})

module.exports = pool;