'use strict';

/**
 * This is a sample Lambda function that sends an Email on click of a
 * button. It creates a SNS topic, subscribes an endpoint (EMAIL)
 * to the topic and publishes to the topic.
 *
 * Follow these steps to complete the configuration of your function:
 *
 * 1. Update the email environment variable with your email address.
 * 2. Enter a name for your execution role in the "Role name" field.
 *    Your function's execution role needs specific permissions for SNS operations
 *    to send an email. We have pre-selected the "AWS IoT Button permissions"
 *    policy template that will automatically add these permissions.
 */

const http = require('http');
const AWS = require('aws-sdk');

const EMAIL = process.env.email;
const SNS = new AWS.SNS({ apiVersion: '2010-03-31' });

var config = {
    "inputThingName": 'iotbutton_G030JF0513034VDM',
    "outputThingName": 'ledLights',
    "endpointAddress": "a2mlydyii6a6zf.iot.us-west-2.amazonaws.com"
};

var iotdata = new AWS.IotData({endpoint:config.endpointAddress, accessKeyId:'KEY', secretAccessKey:'KEY'});


function findExistingSubscription(topicArn, nextToken, cb) {
    const params = {
        TopicArn: topicArn,
        NextToken: nextToken || null,
    };
    SNS.listSubscriptionsByTopic(params, (err, data) => {
        if (err) {
            console.log('Error listing subscriptions.', err);
            return cb(err);
        }
        const subscription = data.Subscriptions.filter((sub) => sub.Protocol === 'email' && sub.Endpoint === EMAIL)[0];
        if (!subscription) {
            if (!data.NextToken) {
                cb(null, null); // indicate that no subscription was found
            } else {
                findExistingSubscription(topicArn, data.NextToken, cb); // iterate over next token
            }
        } else {
            cb(null, subscription); // a subscription was found
        }
    });
}

/**
 * Subscribe the specified EMAIL to a topic.
 */
function createSubscription(topicArn, cb) {
    // check to see if a subscription already exists
    findExistingSubscription(topicArn, null, (err, res) => {
        if (err) {
            console.log('Error finding existing subscription.', err);
            return cb(err);
        }
        if (!res) {
            // no subscription, create one
            const params = {
                Protocol: 'email',
                TopicArn: topicArn,
                Endpoint: EMAIL,
            };
            SNS.subscribe(params, (subscribeErr) => {
                if (subscribeErr) {
                    console.log('Error setting up email subscription.', subscribeErr);
                    return cb(subscribeErr);
                }
                // subscription complete
                console.log(`Subscribed ${EMAIL} to ${topicArn}.`);
                cb(null, topicArn);
            });
        } else {
            // subscription already exists, continue
            cb(null, topicArn);
        }
    });
}

/**
 * Create a topic.
 */
function createTopic(topicName, cb) {
    SNS.createTopic({ Name: topicName }, (err, data) => {
        if (err) {
            console.log('Creating topic failed.', err);
            return cb(err);
        }
        const topicArn = data.TopicArn;
        console.log(`Created topic: ${topicArn}`);
        console.log('Creating subscriptions.');
        createSubscription(topicArn, (subscribeErr) => {
            if (subscribeErr) {
                return cb(subscribeErr);
            }
            // everything is good
            console.log('Topic setup complete.');
            cb(null, topicArn);
        });
    });
}

/**
 * The following JSON template shows what is sent as the payload:
{
    "serialNumber": "GXXXXXXXXXXXXXXXXX",
    "batteryVoltage": "xxmV",
    "clickType": "SINGLE" | "DOUBLE" | "LONG"
}
 *
 * A "LONG" clickType is sent if the first press lasts longer than 1.5 seconds.
 * "SINGLE" and "DOUBLE" clickType payloads are sent for short clicks.
 *
 * For more documentation, follow the link below.
 * http://docs.aws.amazon.com/iot/latest/developerguide/iot-lambda-rule.html
 */
exports.handler = (event, context, callback) => {
    console.log('Received event:', event.clickType);
    // create/get topic
    /*
    createTopic('aws-iot-button-sns-topic', (err, topicArn) => {
        if (err) {
            return callback(err);
        }
        console.log(`Publishing to topic ${topicArn}`);
        // publish message
        const params = {
            Message: `${event.serialNumber} -- processed by Lambda\nBattery voltage: ${event.batteryVoltage}`,
            Subject: `Hello from your IoT Button ${event.serialNumber}: ${event.clickType}`,
            TopicArn: topicArn,
        };
        // result will go to function callback
        SNS.publish(params, callback);
    });
    */
    iotdata.getThingShadow({
        thingName: config.outputThingName
    }, function(err, data) {
        if (err) {
            context.fail(err);
        } else {
            console.log("Got LED Light Shadow:")
            console.log(data);
            // get current PWM
            var currentPwm = JSON.parse(data.payload).state.reported.pwm;
            var manualOverride = JSON.parse(data.payload).state.reported.manualOverride;
            var newPwm = currentPwm; // init
            var newManualOverride = manualOverride; // init
            
            // get new PWM based on click type and current PWM
            
            console.log('Current PWM: ' + currentPwm)
            // This is the hourly trigger handler 
            if (event.clickType === undefined && currentPwm > 0 && manualOverride == 'NO') {
                newManualOverride = 'NO';
                var url = 'http://api.openweathermap.org/data/2.5/weather?q=Seattle&APPID=e91a4cdfd118e5f2616941816df59a65';
                http.get(url, function(res){
                    var body = '';
                
                    res.on('data', function(chunk){
                        body += chunk;
                    });
                
                    res.on('end', function(){
                        var weather = JSON.parse(body);
                        var cloud_cover = weather.clouds.all;
                        var sunrise = new Date(weather.sys.sunrise * 1000); // UTC Date
                        var sunset = new Date(weather.sys.sunset * 1000); // UTC DATE
                        var timeNow = new Date();
                        if (timeNow.getHours() > sunset.getHours() - 1 && timeNow.getHours() < sunrise.getHours() + 1) {
                            console.log("Night-time, using max intensity.");
                            newPwm = 100;
                        } else {
                            newPwm = cloud_cover;
                        }
                        var pwmUpdate = {
                            "state": {
                               "desired" : {
                                    "pwm" : newPwm,
                                    "manualOverride" : newManualOverride
                                }
                            }
                        };
                        iotdata.updateThingShadow({
                            payload: JSON.stringify(pwmUpdate),
                            thingName: config.outputThingName
                        }, function(err, data) {
                            if (err) {
                                console.log("Failed to update LED Shadow")
                                context.fail(err);
                            } else {
                                console.log("Updated LED Shadow:")
                                console.log(data);
                                context.succeed('newPwm: ' + pwmUpdate + ' newManualOverride: ' + newManualOverride);
                            }
                        });
                    });
                }).on('error', function(e){
                      console.log("Got an error: ", e);
                });
                console.log("ACTION: SCHEDULED WEATHER-BASED PWM RESET")
            }
            else if ((event.clickType == 'SINGLE' && currentPwm === 0) || currentPwm === null) {
                // Get weather settings, set PWM accordingly
                newManualOverride = 'NO';
                var url = 'http://api.openweathermap.org/data/2.5/weather?q=Seattle&APPID=e91a4cdfd118e5f2616941816df59a65';
                http.get(url, function(res){
                    var body = '';
                
                    res.on('data', function(chunk){
                        body += chunk;
                    });
                
                    res.on('end', function(){
                        var weather = JSON.parse(body);
                        var cloud_cover = weather.clouds.all;
                        var sunrise = new Date(weather.sys.sunrise * 1000); // UTC Date
                        var sunset = new Date(weather.sys.sunset * 1000); // UTC DATE
                        var timeNow = new Date();
                        if (timeNow.getHours() > sunset.getHours() - 1 && timeNow.getHours() < sunrise.getHours() + 1) {
                            console.log("Night-time, using max intensity.");
                            newPwm = 100;
                        } else {
                            newPwm = cloud_cover;
                        }
                        var pwmUpdate = {
                            "state": {
                               "desired" : {
                                    "pwm" : newPwm,
                                    "manualOverride" : newManualOverride
                                }
                            }
                        };
                        iotdata.updateThingShadow({
                            payload: JSON.stringify(pwmUpdate),
                            thingName: config.outputThingName
                        }, function(err, data) {
                            if (err) {
                                console.log("Failed to update LED Shadow")
                                context.fail(err);
                            } else {
                                console.log("Updated LED Shadow:")
                                console.log(data);
                                context.succeed('newPwm: ' + pwmUpdate + ' newManualOverride: ' + newManualOverride);
                            }
                        });
                    });
                }).on('error', function(e){
                      console.log("Got an error: ", e);
                });
                console.log("ACTION: TURNING ON")
            } else if (event.clickType == 'SINGLE' && currentPwm > 0) {
                // turn lights off
                newPwm = 0;
                newManualOverride = 'NO';
                console.log("ACTION: TURNING OFF");
                var pwmUpdate = {
                    "state": {
                       "desired" : {
                            "pwm" : newPwm,
                            "manualOverride" : newManualOverride
                        }
                    }
                };
                iotdata.updateThingShadow({
                    payload: JSON.stringify(pwmUpdate),
                    thingName: config.outputThingName
                }, function(err, data) {
                    if (err) {
                        console.log("Failed to update LED Shadow")
                        context.fail(err);
                    } else {
                        console.log("Updated LED Shadow:")
                        console.log(data);
                        context.succeed('newPwm: ' + pwmUpdate + ' newManualOverride: ' + newManualOverride);
                    }
                });

            } else if (event.clickType == 'DOUBLE' && manualOverride == 'NO' && currentPwm > 0) {
                // Enable manual override
                newPwm = 100;
                newManualOverride = 'YES';
                console.log("ACTION: ACTIVATE MANUAL OVERRIDE");
                var pwmUpdate = {
                    "state": {
                       "desired" : {
                            "pwm" : newPwm,
                            "manualOverride" : newManualOverride
                        }
                    }
                };
                iotdata.updateThingShadow({
                    payload: JSON.stringify(pwmUpdate),
                    thingName: config.outputThingName
                }, function(err, data) {
                    if (err) {
                        console.log("Failed to update LED Shadow")
                        context.fail(err);
                    } else {
                        console.log("Updated LED Shadow:")
                        console.log(data);
                        context.succeed('newPwm: ' + pwmUpdate + ' newManualOverride: ' + newManualOverride);
                    }
                });
            } else if (event.clickType == 'DOUBLE' && manualOverride == 'YES' && currentPwm > 0) {
                // Disable manual override
                // Get weather
                newPwm = 50;
                newManualOverride = 'NO';
                console.log("ACTION: DISABLE MANUAL OVERRIDE");
                var pwmUpdate = {
                    "state": {
                       "desired" : {
                            "pwm" : newPwm,
                            "manualOverride" : newManualOverride
                        }
                    }
                };
                iotdata.updateThingShadow({
                    payload: JSON.stringify(pwmUpdate),
                    thingName: config.outputThingName
                }, function(err, data) {
                    if (err) {
                        console.log("Failed to update LED Shadow")
                        context.fail(err);
                    } else {
                        console.log("Updated LED Shadow:")
                        console.log(data);
                        context.succeed('newPwm: ' + pwmUpdate + ' newManualOverride: ' + newManualOverride);
                    }
                });
            }
            
        }
    });
};
