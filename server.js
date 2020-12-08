// server.js
// where your node app starts

// require('dotenv').config()
const express = require("express");
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');

var allowCrossDomain = function(req,res,next){
    // res.header('Access-Control-Allow-Origin','https://shugeeth.github.io');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    next();
}

app.use(allowCrossDomain)

//To remove CORS policy error
//app.use(cors());

//Pool to connect to DB
const pool = require("./db")

//Inorder to access body params in req
app.use(express.json())
app.use(express.urlencoded({
    extended: true
}))

//Basic get function to check
app.get('/', (req, res) => {
    res.json({ 
        message: 'Hello, This is the CSK 2020 API Page.' 
    })
})

//login to fetch details from database
app.post('/api/login', (req, res) => {
    //console.log(req);
    if(req.body.fellowId === undefined || req.body.password === undefined){
        res.sendStatus(403);
    }
    else{
        const fid = req.body.fellowId;
        const pass = req.body.password;
        var query =
            "Select f.fellow_id, f.cohort, f.ttf_flag, f.first_name, f.last_name, s.school_name from fellows as f, schools as s WHERE f.fellow_id = "+fid+" AND f.school_id = s.school_id AND f.password = crypt('"+pass+"' , f.password)";

        pool.connect((err, pool) => {
            if (err) {
                return console.error('could not connect to postgres', err);
                throw err;
            }          
            pool.query(query, (err, fellows) => {
                if (err) {
                    console.log(err.stack);
                } else {
                    //User not present
                    if(fellows.rowCount==0){
                        res.sendStatus(401);
                    }
                    else{
                        const fellow = fellows.rows[0];
                        const data = {
                            fellow_id: fellow.fellow_id,
                            cohort: fellow.cohort,
                            ttf_flag: fellow.ttf_flag,
                            first_name: fellow.first_name,
                            last_name: fellow.last_name,
                            school_name: fellow.school_name
                        }
                        jwt.sign(data, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '2h' }, (err, token) => {
                            data.token = token;
                        });
                        // fetch students for the fellow
                        query = 'select s.student_id, s.student_name, s.access, s.phone_number from fellows as f, students as s where f.fellow_id = s.fellow_id and f.fellow_id = '+fid+' order by s.student_id';
                        pool.query(query, (err, students) => {
                            
                            data.students = students.rows;
                            
                            //fetch events for the fellow
                            query = "select e.event_id, to_char(e.event_date,'DD-MM-YYYY') as event_date, ec.event_name, ec.mode, ec.event_type from events as e, events_category as ec where e.event_category_id = ec.event_category_id and e.grade in (select distinct(s.current_grade) from fellows as f, students as s where f.fellow_id = s.fellow_id and f.fellow_id = "+fid+")";
                            pool.query(query,(err,events) => { 
                                
                                data.events = events.rows;

                                //fetch student events mapping data
                                query =`select to_char(e.event_date,'DD-MM-YYYY') as week, ec.mode, sem.event_id, sem.student_id
                                    from fellows as f, students as s, events as e, events_category as ec, students_events_mapping as sem
                                    where e.event_category_id = ec.event_category_id and
                                    sem.event_id = e.event_id and
                                    sem.student_id = sem.student_id and
                                    s.fellow_id = f.fellow_id and
                                    f.fellow_id = `+fid+`
                                    group by e.event_date, ec.mode, sem.event_id, sem.student_id
                                    order by e.event_date, ec.mode, sem.event_id, sem.student_id`;
                                pool.query(query,(err,students_events_map) => { 
                                    if(err){
                                        console.log(err);
                                        throw err
                                    }
                                    else{
                                        data.students_events_map = students_events_map.rows;
                                    }
                                    res.json(data);
                                    pool.end();
                                })
                            })
                        })
                    }
                }
            });
        })
    }
});

//Update student access details in database
app.put('/api/updateStudentAccess', verifyToken, function(req, res) {
    const students = req.body.students;    
    jwt.verify(req.token, process.env.ACCESS_TOKEN_SECRET, (err, authData) => {
        if(err) {
            res.sendStatus(403);
        } 
        else {
            console.log(students.length);
            pool.connect((err, pool) => {
                if (err) {
                    return console.error('could not connect to postgres', err);
                    throw err;
                } else{
                    var i;
                    //Creating a suspendable function to force synchronous operation
                    var suspendable = (async () => {
                        var stuAccessQuery = `Update students set access = $1, phone_number = $2 WHERE student_id = $3`;
                        for( i=0; i<students.length; i++){
                            if(students[i].phone_number==""){
                                students[i].phone_number=null;
                            }
                            await pool.query(stuAccessQuery,[students[i].access, students[i].phone_number, students[i].student_id]);
                            console.log('Updated ',students[i].student_name);
                        }
                        await pool.end();
                        res.json({
                            message: "Updated Student Access Data"
                        })
                    });
                       
                    suspendable();
                }
            })
        }
    });
});

//Update student event grid in database
app.put('/api/updateStudentsEvents', verifyToken, function(req, res) {
    
    const insertRows = req.body.insertRows;
    const deleteRows = req.body.deleteRows;    

    jwt.verify(req.token, process.env.ACCESS_TOKEN_SECRET, (err, authData) => {
        if(err) {
            res.sendStatus(403);
        } 
        else {
            pool.connect((err, pool) => {
                if (err) {
                    return console.error('could not connect to postgres', err);
                    throw err;
                } else{
                    //Creating a suspendable function to force synchronous operation
                    var suspendable = (async () => {
                        var stuEveQuery = `INSERT INTO students_events_mapping (student_id,event_id) VALUES ($1, $2)`;
                        for(var i=0; i<insertRows.length;i++){
                            await pool.query(stuEveQuery,[insertRows[i].student_id, insertRows[i].event_id]);
                            console.log('Inserted Student-',insertRows[i].student_id, ' with Event-', insertRows[i].event_id);
                        } 
                        var stuEveQuery = `DELETE FROM students_events_mapping where student_id = $1 and event_id = $2`;
                        for(i=0; i<deleteRows.length;i++){
                            await pool.query(stuEveQuery,[deleteRows[i].student_id, deleteRows[i].event_id]);
                            console.log('Deleted Student-',deleteRows[i].student_id, ' with Event-', deleteRows[i].event_id);
                        }
                        await pool.end();
                        res.json({
                            message: "Updated Student Event Grid"
                        })
                    });
                       
                    suspendable();
                }
            })
        }
    });
});

//Change fellow password in database
app.post('/api/changePassword', verifyToken, (req, res) => {   
    const fellow_id = req.body.fellow_id;
    const pass = req.body.password;
    jwt.verify(req.token, process.env.ACCESS_TOKEN_SECRET, (err, authData) => {
        if(err) {
            res.sendStatus(403);
        } else {
            const query = "Update fellows set password= crypt('"+pass+"', gen_salt('bf')) WHERE fellow_id = "+fellow_id;
            pool.connect((err, pool) => {
                if (err) {
                    return console.error('could not connect to postgres', err);
                    throw err;
                }          
                pool.query(query, (err, query_res) => {
                    if (err) {
                        console.log(err.stack);
                    } else {
                        res.json({
                            message: 'Password Changed Successfully',
                            fellow_id: authData.fellow_id,
                        });
                    }
                    pool.end();
                })
            });
            //res.json(<Entire_Fellow_Record>.filter(post => post.fellow_id === authData.fellow_id))
        }
    });
})

//Function to verify header token for JWT Authentication

// FORMAT OF TOKEN
// Authorization: Bearer <access_token>

function verifyToken(req, res, next){
    /// Get auth header value
    const bearerHeader = req.headers['authorization'];
    // Check if bearer is undefined
    if(typeof bearerHeader !== 'undefined') {
        // Split at the space
        const bearer = bearerHeader.split(' ');
        // Get token from array
        const bearerToken = bearer[1];
        // Set the token
        req.token = bearerToken;
        // Next middleware
        next();
    } else {
        // Forbidden
        res.sendStatus(401);
    }
}

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
