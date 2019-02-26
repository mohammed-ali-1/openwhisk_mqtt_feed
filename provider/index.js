const express = require('express');
const FeedController = require('./lib/feed_controller.js');

//Using dotenv to handle CouchDB configuration
const dotenv = require('dotenv');
dotenv.config();

//Connect to the CouchDB instance
let creds = {};
if (
  process.env.COUCHDB_USER &&
  process.env.COUCHDB_PASS &&
  process.env.COUCHDB_HOST &&
  process.env.COUCHDB_HOST_PORT
) {
  creds.username = process.env.COUCHDB_USER;
  creds.password = process.env.COUCHDB_PASS;
  creds.host = process.env.COUCHDB_HOST;
  creds.port = process.env.COUCHDB_HOST_PORT;
} else {
  console.error('Missing CouchDB credentials...');
  process.exit(1);
}

//Connect to the CouchDB instance
const Nano = require('nano')(
  `http://${creds.username}:${creds.password}@${creds.host}:${creds.port}`,
);

// setup express for handling HTTP requests
const app = express();
const bodyparser = require('body-parser');
app.use(bodyparser.json());

const openwhisk_hostname = process.env.OPENWHISK_API_HOSTNAME;
const feed_controller = new FeedController(
  Nano.db.use('topic_listeners'),
  `${openwhisk_hostname}`,
);

feed_controller.initialise().then(() => {
  const handle_error = (err, message, res) => {
    console.log(message, err);
    res.status(500).json({error: message});
  };

  app.post('/mqtt', function(req, res) {
    // trigger (namespace/name), url, topic, username, password
    feed_controller
      .add_trigger(req.body)
      .then(() => res.send())
      .catch(err => handle_error(err, 'failed to add MQTT topic trigger', res));
  });

  app.delete('/mqtt/:namespace/:trigger', (req, res) => {
    feed_controller
      .remove_trigger(req.params.namespace, req.params.trigger)
      .then(() => res.send())
      .catch(err =>
        handle_error(err, 'failed to remove MQTT topic trigger', res),
      );
  });

  app.listen(3000, function() {
    console.log('MQTT Trigger Provider listening on port 3000!');
  });
});
