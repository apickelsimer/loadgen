// runLoad.js
// ------------------------------------------------------------------
//
// Run a set of REST requests from Node, as specified in a job
// definition file. This is to generate load for API Proxies.
//
// This script uses various npm modules. You may need to do the
// following to get pre-requisites before running this script:
//
//   npm install
//
// There is an API for this target.
//
// GET /status
//   returns a json payload providing status of the service.
//   Keep in mind the status is for the nodejs logic on a single MP only.
//   There are typically multiple MPs, so invoking GET /status multiple
//   times in succession will likely deliver different responses. A response
//   looks like this:
//
//   {
//     "loadGenVersion": "Saturday, 31 January 2015, 14:38",
//     "times": {
//       "start": "Fri Feb 13 2015 02:58:10 GMT-0000 (UTC)",
//       "lastRun": "Fri Feb 13 2015 03:07:28 GMT-0000 (UTC)",
//       "wake": "Fri Feb 13 2015 03:08:38 GMT-0000 (UTC)",
//       "current": "Fri Feb 13 2015 03:08:06 GMT-0000 (UTC)"
//     },
//     "loglevel": 2,
//     "nRequests": 42,
//     "jobId": "hnacino-azure-job1",
//     "description": "drive Henry's Azure-hosted APIs",
//     "status": "waiting",
//     "responseCounts": {
//       "total": 42,
//       "200": 41,
//       "401": 1
//     },
//     "statusCacheKey": "runload-status-hnacino-azure-job1",
//     "loglevelCacheKey": "runload-loglevel-hnacino-azure-job1",
//     "nCycles": null,
//     "durationOfLastRunInMs": 1632,
//     "currentRunsPerHour": 51,
//     "cachedStatus": "-none-"
//   }
//
// POST /control
//   pass a x-www-form-urlencoded payload . eg, Use this header:
//        Content-type:application/x-www-form-urlencoded
//
//   Option 1: start or stop the calls being emitted from the nodejs script.
//   use param action=start or action=stop
//
//   You need to send this request just once, to stop all MPs
//   that are generating load.
//
//   Option 2: set the log level.
//   use param action=setlog&loglevel=N
//
//   where N = [0,10]
//     0 = almost no logging
//     2 = very minimal logging - only wake/sleep and errors
//     3 = see each API call out.
//      progressively more info
//    10 = max logging
//
// created: Wed Jul 17 18:42:20 2013
// last saved: <2015-July-01 14:11:35>
// ------------------------------------------------------------------
//
// Copyright ¬© 2013, 2014, 2015 Dino Chiesa and Apigee Corp
// Updated 2019 apickelsimer - Google LLC
// All rights reserved.
//
// ------------------------------------------------------------------

const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 --config [path] --loglevel [0-10]')
    .option('config', {
        describe: 'Path to the configuration model file (local or URL).',
        demandOption: true,
        type: 'string'
    })
    .option('loglevel', {
        describe: 'Logging level (0=silent, 10=verbose).',
        default: 2,
        type: 'number'
    })
    .argv;

const assert = require('assert');
const http = require('http');
const express = require('express');
const fs = require('fs');
const { JSONPath } = require('jsonpath-plus');
const WeightedRandomSelector = require('./lib/weightedRandomSelector.js');

const app = express();
const globalTimeout = 8000; // in ms
const defaultRunsPerHour = 600;
const oneHourInMs = 60 * 60 * 1000;
const minSleepTimeInMs = 0;
let model;
const log = new Log();
const isUrl = new RegExp('^https?://[-a-z0-9\\.]+($|/)', 'i');
let wantMasking = true;
let gModel;
let gDefaultLogLevel = 0;
const gStatus = {
        loadGenVersion: '2.0.0 (2023-August-21)',
        times: {
            start: new Date().toString(),
            lastRun: null,
        },
        nRequests: 0,
        jobId: '',
        description: '',
        status: 'initializing',
        responseCounts: {
            total: 0
        }
    };
const globals = {};
const rStringChars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';


model = argv.config;
gDefaultLogLevel = argv.loglevel;
gStatus.loglevel = gDefaultLogLevel;


class Gaussian {
    constructor(mean, stddev) {
        this.mean = mean;
        this.stddev = stddev || mean * 0.1;
    }

    /*
       Function normal.

       Generator of pseudo-random number according to a normal distribution
       with mean=0 and variance=1.
       Use the Box-Mulder (trigonometric) method, and discards one of the
       two generated random numbers.
    */
    normal() {
        let u1 = 0,
            u2 = 0;
        while (u1 * u2 === 0) {
            u1 = Math.random();
            u2 = Math.random();
        }
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    next() {
        return this.stddev * this.normal() + 1 * this.mean;
    }
}

class Log {
  write(level, str) {
      if (gStatus.loglevel >= level) {
          const time = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
          console.log(`[${time}] ${str}`);
      }
  }
}

function isNumber(n) {
    if (typeof n === 'undefined') {
        return false;
    }
    // the variable is defined
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function randomString(length) {
    var i, result = '';
    length = length || Math.ceil((Math.random() * 28)) + 12;
    for (i = length; i > 0; --i) {
        result += rStringChars[Math.round(Math.random() * (rStringChars.length - 1))];
    }
    return result;
}

function randomName() {
    return selectGivenName() + '-' +
        Math.floor((Math.random() * 10000));
}

function selectGivenName() {
    var names = ['Ashish', 'Nikhil', 'Seshadri', 'Kyle', 'Jeff', 'Neha', 'Jin', 'Lewis', 'Fernando', 'Rajeev', 'Mary', 'Sophia', 'Rose', 'Julianna', 'Grace', 'Janice', 'Niko', 'Anish'],
        n = names[Math.floor((Math.random() * names.length))];
    return n;
}

function copyHash(obj) {
    var copy = {};
    if (null !== obj && typeof obj == "object") {
        Object.keys(obj).forEach(function(attr) {
            copy[attr] = obj[attr];
        });
    }
    return copy;
}

// trackFailure is replaced by try/catch blocks in async functions.

function getType(obj) {
    return Object.prototype.toString.call(obj);
}

function logTransaction(e, req, res, obj, payload) {
    console.log('\n' + req.method + ' ' + req.path);
    console.log('headers: ' + JSON.stringify(req._headers, null, 2));
    if (payload) {
        console.log('payload: ' + JSON.stringify(payload, null, 2));
    }
    console.log('\nresponse status: ' + res.statusCode);
    console.log('response body: ' + JSON.stringify(obj, null, 2) + '\n\n');
    assert.ifError(e);
}

function maskToken(value) {
    if (!value) {
        return value;
    }
    if (!wantMasking) {
        return value;
    }
    if (!startsWith(value, 'Bearer ')) return value;
    return 'Bearer *******';
}

function startsWith(str, frag) {
    return str && (str.slice(0, frag.length) == frag);
}

function dayNumberToName(name) {
    var map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        n = name.toLowerCase(),
        ix = map.indexOf(n);
    if (ix < 0) {
        ix = map.map(function(s) {
            return s.substring(0, 3);
        }).indexOf(n);
    }
    return ix;
}

async function retrieveConfig(source) {
    if (isUrl.test(source)) {
        log.write(2, `Retrieving remote config from: ${source}`);
        const response = await require('axios').get(source, { timeout: 16000 });
        return response.data;
    }
    log.write(2, `Reading local config from: ${source}`);
    if (!fs.existsSync(source)) {
        throw new Error(`Cannot load local configuration: ${source}`);
    }
    return JSON.parse(fs.readFileSync(source, "utf8"));
}

function chooseRandomIpFromRecord(rec) {
    var ranges, numRanges, selectedRange,
        start, end, index,
        selected, w, x, y, z, allGood;
    if (!rec) {
        return null;
    }

    // It's possible we'll get bad data from the request, in which case
    // rec.ranges may be invalid. Or, any of the other successive fields
    // may be invalid. In that case, bail.
    allGood = (ranges = rec.ranges) &&
        (numRanges = ranges.length) &&
        (selectedRange = ranges[Math.floor(Math.random() * numRanges)]) &&
        (start = parseInt(selectedRange[0], 10)) &&
        (end = parseInt(selectedRange[1], 10)) &&
        (index = Math.floor(Math.random() * (start - end))) &&
        (selected = start + index) &&
        (w = Math.floor((selected / 16777216) % 256)) &&
        (x = Math.floor((selected / 65536) % 256)) &&
        (y = Math.floor((selected / 256) % 256)) &&
        (z = Math.floor((selected) % 256));

    if (allGood)
        return w + "." + x + "." + y + "." + z;

    return null;
}

async function contriveDataFromUrl(url, context, key) {
    if (!url) {
        log.write(5, `No URL provided for ${key}, skipping.`);
        return context;
    }
    try {
        log.write(8, `Contriving ${key} from ${url}`);
        const response = await require('axios').get(url, { timeout: 16000 });
        context.job[key] = response.data;
        log.write(2, `Contrived ${key} = ${JSON.stringify(response.data)}`);
    } catch (e) {
        log.write(2, `contriveDataFromUrl (${key}), error: ${e.message}`);
    }
    return context;


    /*var city, ql, options, deferred;

    function choose(cityData) {
      context.job.contrivedIp = chooseRandomIpFromRecord(cityData);
      context.job.chosenCity = city.name;
      log.write(8,'contriveIpAddress: ' + city.name + ' ' + context.job.contrivedIp);
    }

    log.write(10,'contriveIpAddress');
    if (!globals.citySelector) {
      return context;
    }

    city = globals.citySelector.select()[0];

    log.write(10,'contriveIpAddress: city: ' + city.name);

    if (globals.hasOwnProperty('cities') && globals.cities[city.name]) {
      // the selected city has been cached.
      choose(globals.cities[city.name]);
      return context;
    }

    // must do a lookup
    //ql = "select * where city='" + city.name + "'";
    options = {
      timeout : 16000, // in ms
      uri : ipForCities,
      method: 'get',
      headers: {
        'Accept' : 'application/json',
        'user-agent' : 'SlimHttpClient/1.0'
      }
    };
    deferred = q.defer();

    request(options, function(e, httpResp, body) {
      var type;
      if (e) {
        log.write(2,'contriveIpAddress, error: ' + e);
      }
      else {
        type = Object.prototype.toString.call(body);
        if (type === "[object String]") {
          try {
            body = JSON.parse(body);
          }
          catch(exc1) {
            log.write(2,'contriveIpAddress: cannot parse body :(');
          }
        }
        if (body.entities && body.entities[0]) {
          if (!globals.cities) { globals.cities = {}; }
          // do not cache this data - see APIRT-1974
          //globals.cities[city.name] = body.entities[0];
          choose(body.entities[0]);
        }
        else {
          log.write(2,'contriveIpAddress: no body entities');
        }
      }
      deferred.resolve(context);
    });
    return deferred.promise;  */
}

// No-op, replaced by contriveDataFromUrl
function contriveUserAgent(context) {
    return context;
}

const generators = {
    randomString: (length) => {
        let result = '';
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let i = length > 0 ? length : 12; i > 0; --i) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    },
    randomName: () => {
        const names = ['Ashish', 'Nikhil', 'Seshadri', 'Kyle', 'Jeff', 'Neha', 'Jin', 'Lewis', 'Fernando', 'Rajeev', 'Mary', 'Sophia', 'Rose', 'Julianna', 'Grace', 'Janice', 'Niko', 'Anish'];
        return names[Math.floor(Math.random() * names.length)];
    },
    timestamp: () => Date.now()
};

function expandEmbeddedTemplates(context, obj) {
    const type = getType(obj);
    if (type === "[object String]") {
        return obj.replace(/{(\w+)}/g, (match, key) => {
            return context.state.extracts[key] || match;
        });
    }
    if (type === "[object Array]") {
        return obj.map(item => expandEmbeddedTemplates(context, item));
    }
    if (type === "[object Object]") {
        const newObj = {};
        for (const prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                newObj[prop] = expandEmbeddedTemplates(context, obj[prop]);
            }
        }
        return newObj;
    }
    return obj;
}


// ==================================================================

async function invokeOneRequest(context) {
    const { state, job } = context;
    const sequence = job.sequences[state.sequence];
    const req = sequence.requests[state.request];

    log.write(4, `${job.id} invokeOneRequest`);

    if (req.delayBefore) {
        const delay = Number(req.delayBefore);
        if (!isNaN(delay)) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Process imports
    if (req.imports && req.imports.length > 0) {
        for (const imp of req.imports) {
            if (generators[imp.generator]) {
                const args = imp.args || [];
                state.extracts[imp.valueRef] = generators[imp.generator](...args);
                log.write(5, `Generated ${imp.valueRef} := ${state.extracts[imp.valueRef]}`);
            }
        }
    }

    // Resolve URL and headers with templating
    const url = expandEmbeddedTemplates(context, req.url || req.pathSuffix);
    const headers = expandEmbeddedTemplates(context, {
        ...(job.defaultProperties?.headers || {}),
        ...(req.headers || {})
    });

    if (job.contrivedIp) {
        headers['x-forwarded-for'] = job.contrivedIp;
    }
    if (job.contrivedUserAgent) {
        headers['User-Agent'] = job.contrivedUserAgent;
    }

    const reqOptions = {
        method: (req.method || 'get').toLowerCase(),
        timeout: globalTimeout,
        headers,
        validateStatus: () => true // Handle all status codes in the response
    };

    if (isUrl.test(url)) {
        reqOptions.url = url;
    } else {
        const { scheme, host, port } = job.defaultProperties;
        const portString = (port && port !== 80 && port !== 443) ? `:${port}` : '';
        reqOptions.url = `${scheme}://${host}${portString}${url}`;
    }

    if (reqOptions.method === 'post' || reqOptions.method === 'put') {
        reqOptions.data = expandEmbeddedTemplates(context, req.payload);
        if (!headers['content-type']) {
            if (typeof reqOptions.data === 'object') {
                headers['content-type'] = 'application/json';
            } else {
                headers['content-type'] = 'application/x-www-form-urlencoded';
            }
        }
    }

    log.write(3, `${reqOptions.method.toUpperCase()} ${reqOptions.url}`);
    Object.entries(headers).forEach(([key, value]) => log.write(7, `  ${key}: ${maskToken(value)}`));

    try {
        const httpResp = await require('axios')(reqOptions);
        gStatus.nRequests++;
        const statusCodeStr = String(httpResp.status);
        gStatus.responseCounts[statusCodeStr] = (gStatus.responseCounts[statusCodeStr] || 0) + 1;
        gStatus.responseCounts.total++;
        log.write(2, `==> ${httpResp.status}`);

        if (req.extracts && req.extracts.length > 0) {
            for (const ex of req.extracts) {
                let sourceData;
                if (ex.source === 'body') {
                    sourceData = httpResp.data;
                } else if (ex.source === 'headers') {
                    sourceData = httpResp.headers;
                }

                if (sourceData) {
                    const result = JSONPath({ path: ex.path, json: sourceData, wrap: false });
                    if (result) {
                        state.extracts[ex.valueRef] = result;
                        log.write(5, `Extracted ${ex.valueRef} := ${JSON.stringify(result)}`);
                    } else {
                        log.write(5, `JSONPath for ${ex.valueRef} returned no result for path: ${ex.path}`);
                    }
                }
            }
        }
    } catch (e) {
        log.write(0, `Request failed: ${e.message}`);
        gStatus.lastError = { message: e.stack.toString(), time: new Date().toString() };
    }
    state.request++;
    return context;
}

// ==================================================================

function reportModel(context) {
    console.log('================================================');
    console.log('==         Job Definition Retrieved           ==');
    console.log('================================================');
    console.log(JSON.stringify(context, null, 2));
    return context;
}


function setInitialContext(ctx) {
    gStatus.status = "initializing";
    return {
        job: ctx
    };
}

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

async function runJob(context) {
    if (gStatus.status !== 'running') {
        log.write(2, 'Job status is not "running", halting execution.');
        return;
    }

    const { job, state } = context;
    log.write(3, `runJob: S ${state.sequence + 1}/${state.S}, I ${state.iteration + 1}/${state.I[state.sequence]}, R ${state.request + 1}/${state.R}`);

    // If first request of first iteration of first sequence, contrive data
    if (state.sequence === 0 && state.iteration === 0 && state.request === 0) {
        if (job.ipServiceUrl) {
          context = await contriveDataFromUrl(job.ipServiceUrl, context, 'contrivedIp');
        }
        if (job.userAgentServiceUrl) {
          context = await contriveDataFromUrl(job.userAgentServiceUrl, context, 'contrivedUserAgent');
        }
    }

    await invokeOneRequest(context);

    // Check if sequence/iteration is complete and move to the next
    if (state.request >= state.R) {
        state.request = 0;
        state.iteration++;
        if (state.iteration >= state.I[state.sequence]) {
            state.iteration = 0;
            state.sequence++;
        }
    }

    // If all sequences are done, schedule next run
    if (state.sequence >= state.S) {
        setWakeup(context);
        return;
    }

    // Otherwise, continue the job
    state.R = job.sequences[state.sequence].requests.length;
    state.I[state.sequence] = state.I[state.sequence] || Number(job.sequences[state.sequence].iterations) || 1;
    
    // Use setImmediate to avoid deep call stacks for very fast requests
    setImmediate(() => runJob(context));
}


function initializeJobRun(context) {
    const { job } = context;
    const now = new Date();

    const newState = {
        sequence: 0,
        S: job.sequences.length,
        request: 0,
        R: job.sequences[0].requests.length,
        iteration: 0,
        I: [],
        extracts: copyHash(job.initialContext) || {},
        start: now.valueOf()
    };
    newState.I[0] = Number(job.sequences[0].iterations) || 1;

    context.state = newState;

    gStatus.status = 'running';
    gStatus.jobId = job.id || '-none-';
    gStatus.description = job.description || '-none-';

    runJob(context).catch(e => {
        log.write(0, `Unhandled error in runJob: ${e}`);
        log.write(0, e.stack);
    });
}

function checkStatus(){
  return gStatus.status;
}

function stopJob(){
  log.write(2,"Stopping service....");
  while (gStatus.status != "stopped") {
  gStatus.status = "stopped";
  } 
}

function startJob(context){
  gStatus.status = "started";
  kickoff();
}

function setWakeup(context) {
    const { job } = context;
    const now = new Date();
    const durationOfLastRun = now - context.state.start;

    log.write(3, 'setWakeup');
    gStatus.nCycles++;
    gStatus.times.lastRun = now.toString();
    gStatus.durationOfLastRunInMs = durationOfLastRun;

    const runsPerHour = job.runsPerHour || defaultRunsPerHour;
    const g = new Gaussian(oneHourInMs / runsPerHour);
    let sleepTimeInMs = Math.floor(g.next()) - durationOfLastRun;

    if (sleepTimeInMs < minSleepTimeInMs) {
        sleepTimeInMs = minSleepTimeInMs;
    }

    const wakeTime = new Date(Date.now() + sleepTimeInMs);
    log.write(2, `${job.id} sleep ${sleepTimeInMs}ms, wake at ${wakeTime.toTimeString().substr(0, 8)}`);

    gStatus.currentRunsPerHour = runsPerHour;
    gStatus.status = "waiting";
    gStatus.times.wake = wakeTime.toString();

    setTimeout(() => {
        if (gStatus.status === 'stopped') {
            log.write(2, 'Job is stopped. Not waking up.');
            return;
        }
        log.write(2, `${job.id} awake`);
        delete gStatus.times.wake;
        initializeJobRun({ job });
    }, sleepTimeInMs);
}

// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

const kickoff = async () => {
    try {
        log.write(2, "Kicking off job...");
        gModel = await retrieveConfig(argv.config);
        log.write(3, `Model loaded: ${JSON.stringify(gModel, null, 2)}`);

        if (!gModel.id) {
            throw new Error("Configuration model must have a unique 'id' property.");
        }
        initializeJobRun({ job: gModel });
    } catch (e) {
        log.write(0, `FATAL: ${e.message}`);
        log.write(0, e.stack);
        process.exit(1);
    }
};

// =======================================================
// API Endpoints
// =======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/status', (req, res) => {
    gStatus.times.current = new Date().toString();
    res.status(200).json(gStatus);
});

const stopJob = () => {
    if (gStatus.status !== 'stopped') {
        log.write(1, 'Stopping service...');
        gStatus.status = 'stopped';
    }
};

const startJob = () => {
    if (gStatus.status === 'stopped') {
        log.write(1, 'Starting service...');
        gStatus.status = 'initializing'; // Will be set to 'running' by initializeJobRun
        initializeJobRun({ job: gModel });
    }
};

app.post('/control', (req, res) => {
    const action = req.body.action || req.query.action;
    log.write(2, `Control action received: ${action}`);

    switch(action) {
        case 'stop':
            stopJob();
            res.status(200).send('Service stopping.');
            break;
        case 'start':
            startJob();
            res.status(200).send('Service starting.');
            break;
        case 'reload':
            stopJob();
            // Give it a moment to halt any running jobs before reloading
            setTimeout(() => {
                kickoff().then(() => {
                    res.status(200).send('Service reloaded with new config.');
                }).catch(e => {
                    res.status(500).send(`Failed to reload: ${e.message}`);
                });
            }, 500);
            break;
        case 'setlog':
            const level = parseInt(req.body.loglevel || req.query.loglevel, 10);
            if (!isNaN(level) && level >= 0 && level <= 10) {
                gStatus.loglevel = level;
                res.status(200).json({ message: `Log level set to ${level}`, newLevel: level });
            } else {
                res.status(400).send('Invalid loglevel. Must be a number between 0 and 10.');
            }
            break;
        default:
            res.status(400).send('Invalid action. Use start, stop, reload, or setlog.');
    }
});

app.all('*', (req, res) => {
    res.status(404).json({ message: "Endpoint not found." });
});

port = process.env.PORT || 8080;

app.listen(port, function() {
    setTimeout(function() {
        return kickoff();
    }, 1200);
});

module.exports = {
    Gaussian,
    Log,
    expandEmbeddedTemplates,
    generators
};