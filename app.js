'use strict';

var SwaggerExpress = require('swagger-express-mw');
var express = require('express');
var fs = require('fs');
var path = require("path");
var morgan = require('morgan');
let log = require('./logger.js');
let generateSwagger = require('./generateSwagger.js');
let http = require("http");
let https = require("https");

generateSwagger.generate().then(() => {


    function getServer() {
        if (process.env.PROTOCOL === "https" ) {
            let certificate = fs.readFileSync(process.env.SSL_CERT);
            let privateKey = fs.readFileSync(process.env.SSL_KEY);
            log.info("creating https server");
            let server = https.createServer({key: privateKey, cert: certificate}, app);
            server.setTimeout(0);
            return server;
        }
        else {
            log.info("creating http server");
            let server = http.createServer(app);
            server.setTimeout(0);
            return server;
        }
    }

    var app = express();

    // create a write stream (in append mode) and set up a log to record requests
    let accessLogStream = fs.createWriteStream(path.join("./logs", "access.log"), {flags: "a"});
    app.use(morgan("combined", {stream: accessLogStream}));

    module.exports = app; // for testing
    const util = require('util');

    var config = {
        appRoot: __dirname, // required config
        swaggerSecurityHandlers: {
            api_key: function (req, authOrSecDef, scopesOrApiKey, cb) {
                // your security code
                if ('1234' === scopesOrApiKey) {
                    cb(null);
                } else {
                    cb(new Error('access denied!'));
                }
            }
        }
    };

    process.on("uncaughtException", (err) => {
        log.error(err, "Something Broke!.");
        console.error(err.stack);
    });

    app.use((req,res,next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });

    app.use(express.static('api/swagger'));

    const imagePath = '/var/www/data-site/files/npn-geo-services/clipped_images';

// app.use(express.static('static/rasters'));
    app.use(express.static(imagePath));

    SwaggerExpress.create(config, (err, swaggerExpress) => {
        if (err) { throw err; }

        // install middleware
        swaggerExpress.register(app);

        let server = getServer();

        server.listen(process.env.PORT || 3006, () => {
            log.info("Server listening on port " + (process.env.PORT || 3006));
        });

        // // install middleware
        // swaggerExpress.register(app);
        //
        // //todo 3006 is here because 'swagger project test' doesn't pick up the env port
        // app.listen(process.env.PORT || 3006);
        //
        // log.info('listening on port 3006');
        // log.error('this is a test error!');

        setInterval(function() {
            console.log('HeapUsed in MB: ' + process.memoryUsage().heapUsed / 1048576);
            //console.log(util.inspect(process.memoryUsage()));
        },1000);
    });

}).catch(err => {
    log.error(err, 'could not generate swagger.yaml, haulting server');
    process.exit(1);
});


