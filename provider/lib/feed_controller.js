const mqtt = require('mqtt');
const openwhisk = require('openwhisk');
const MQTTSubscriptionMgr = require('./mqtt_subscription_mgr.js');
const TriggerStore = require('./trigger_store.js');

class FeedController {
  constructor(db, ow_endpoint) {
    this.mqtt_subscription_mgr = new MQTTSubscriptionMgr(mqtt);
    this.trigger_store = new TriggerStore(db);
    this.ow_endpoint = ow_endpoint;
  }

  initialise() {
    const mgr = this.mqtt_subscription_mgr;
    mgr.on('message', (url, topic, message) =>
      this.on_message(url, topic, message),
    );
    mgr.on('connected', url => this.on_conn_status('connected', url));
    mgr.on('disconnected', url => this.on_conn_status('disconnected', url));

    return this.trigger_store
      .subscribers()
      .then(subscribers => {
        subscribers.forEach(s => mgr.subscribe.apply(mgr, s.topic.split('#')));
      })
      .catch(err => {
        console.error(
          'Error initialising subscribers from couchdb store.',
          err.reason,
        );
        return Promise.reject('Unable to initialise due to store failure.');
      });
  }

  on_conn_status(status, url) {
    const params = {type: 'status', body: status};
    this.trigger_store
      .triggers(url)
      .then(triggers => {
        triggers.forEach(trigger => this.fire_trigger(trigger, params));
      })
      .catch(err =>
        console.error('Unable to forward connection status to triggers.', err),
      );
  }

  on_message(url, topic, message) {
    console.log(`Message received (${url}) #${topic}: ${message}`);
    const params = {type: 'message', body: message};
    this.trigger_store
      .triggers(url, topic)
      .then(triggers => {
        triggers.forEach(trigger => this.fire_trigger(trigger, params));
      })
      .catch(err =>
        console.error('Unable to forward message to triggers.', err.reason),
      );
  }

  fire_trigger(trigger, params) {
    console.log(`Firing trigger: ${trigger.trigger}`, params);
    const [namespace, name] = trigger.trigger.split('/').slice(1);
    var ow = openwhisk({
      api: this.ow_endpoint,
      api_key: `${trigger.username}:${trigger.password}`,
      namespace: namespace,
      ignore_certs: true,
    });
    ow.triggers
      .invoke({triggerName: name, params: params})
      .catch(err =>
        console.error(`Failed to fire trigger ${trigger.trigger}`, err.reason),
      );
  }

  add_trigger(trigger) {
    const mgr = this.mqtt_subscription_mgr;
    return this.trigger_store.add(trigger).then(() => {
      mgr.subscribe(trigger.url, trigger.topic);
      if (mgr.is_connected(trigger.url)) {
        const params = {type: 'status', body: 'connected'};
        this.fire_trigger(trigger, params);
      }
    });
  }

  remove_trigger(namespace, trigger) {
    const mgr = this.mqtt_subscription_mgr;
    namespace = '/' + namespace;
    return this.trigger_store
      .remove(`${namespace}/${trigger}`)
      .then(() => mgr.unsubscribe(trigger.url, trigger.topic));
  }
}

module.exports = FeedController;
