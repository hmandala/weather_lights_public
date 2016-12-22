'''
/*
 * Copyright 2010-2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *  http://aws.amazon.com/apache2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */
 '''

from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTShadowClient
import sys
import logging
import time
import json
import getopt

import requests
import arrow
import RPi.GPIO as GPIO

# Shadow JSON schema:
#
# Name: Bot
# {
#	"state": {
#		"desired":{
#			"property":<INT VALUE>
#		}
#	}
#}

"""
def get_duty_cycle(weather):
	cloud_cover = weather["clouds"]["all"]
	sunrise = arrow.get(weather["sys"]["sunrise"]).to('US/Pacific').replace(day=1, month=1, year=1900)

	sunset = arrow.get(weather["sys"]["sunset"]).to('US/Pacific').replace(day=1, month=1, year=1900)
	time_now = arrow.utcnow().to('US/Pacific').replace(day=1, month=1, year=1900)
	#TEST: time_now = time_now.replace(hours=+12).replace(day=1, month=1, year=1900)
	print weather
	if (time_now < sunrise.replace(minutes=+30)  or time_now > sunset.replace(minutes=-30)):
		print "Night, using max intensity." #TODO: Log this
		return 100
	else:
		print "Day, using cloud cover value: %d" % cloud_cover
		return cloud_cover #TODO can we learn this value per the users preferences?
"""

# Custom Shadow update callback
def customShadowCallback_Update(payload, responseStatus, token):
        # payload is a JSON string ready to be parsed using json.loads(...)
        # in both Py2.x and Py3.x
        print "In updater..."
        if responseStatus == "timeout":
                print("Update request " + token + " time out!")
        if responseStatus == "accepted":
                payloadDict = json.loads(payload)
                print "Update success!"
                #print("~~~~~~~~~~~~~~~~~~~~~~~")
                #print("Update request with token: " + token + " accepted!")
                #print("property: " + str(payloadDict["state"]["desired"]["property"]))
                #print("~~~~~~~~~~~~~~~~~~~~~~~\n\n")
                p.ChangeDutyCycle(payloadDict["state"]["reported"]["pwm"])
        if responseStatus == "rejected":
                print("Update request " + token + " rejected!")
                

def customShadowCallback_Get(payload, responseStatus, token):
	# Get desired state
	payloadDict = json.loads(payload)
	print payloadDict
        print "desired state:"
        print payloadDict['state']['desired']
	
        print "current reported state:"
        print payloadDict['state']['reported']
	# Set reported state
	payloadDict['state']['reported'] = dict(payloadDict['state']['desired'])
        jsonDict =  '{"state":{"reported":' + json.dumps(payloadDict['state']['reported']) + '}, "desired":null}'
	print "calc New state:"
        print jsonDict
	print "Calling updater..."
	Bot.shadowUpdate(jsonDict, customShadowCallback_Update, 5)
	print "Finished updating to new state."


# Custom Shadow callback
def customShadowCallback_Delta(payload, responseStatus, token):
	# payload is a JSON string ready to be parsed using json.loads(...)
	# in both Py2.x and Py3.x
	print(responseStatus)
	#payloadDict = json.loads(payload)
        Bot.shadowGet(customShadowCallback_Get, 5)
	#print payloadDict
	#print("++++++++DELTA++++++++++")
	#print("property: " + str(payloadDict["state"]["pwm"]))
	#print("property: " + str(payloadDict["state"]["manualOverride"]))
        #JSONPayload = '{"state":{"reported":{"pwm":' + str(payloadDict["state"]["pwm"]) + ', "manualOverride":"' + payloadDict["state"]["manualOverride"] + '"}}}'
        #print JSONPayload
	#Bot.shadowUpdate(JSONPayload, customShadowCallback_Update, 5)


# Usage
usageInfo = """Usage:

Use certificate based mutual authentication:
python basicShadowDeltaListener.py -e <endpoint> -r <rootCAFilePath> -c <certFilePath> -k <privateKeyFilePath>

Use MQTT over WebSocket:
python basicShadowDeltaListener.py -e <endpoint> -r <rootCAFilePath> -w

Type "python basicShadowDeltaListener.py -h" for available options.


"""
# Help info
helpInfo = """-e, --endpoint
	Your AWS IoT custom endpoint
-r, --rootCA
	Root CA file path
-c, --cert
	Certificate file path
-k, --key
	Private key file path
-w, --websocket
	Use MQTT over WebSocket
-h, --help
	Help information


"""

# Read in command-line parameters
useWebsocket = False
host = ""
rootCAPath = ""
certificatePath = ""
privateKeyPath = ""
try:
	opts, args = getopt.getopt(sys.argv[1:], "hwe:k:c:r:", ["help", "endpoint=", "key=","cert=","rootCA=", "websocket"])
	if len(opts) == 0:
		raise getopt.GetoptError("No input parameters!")
	for opt, arg in opts:
		if opt in ("-h", "--help"):
			print(helpInfo)
			exit(0)
		if opt in ("-e", "--endpoint"):
			host = arg
		if opt in ("-r", "--rootCA"):
			rootCAPath = arg
		if opt in ("-c", "--cert"):
			certificatePath = arg
		if opt in ("-k", "--key"):
			privateKeyPath = arg
		if opt in ("-w", "--websocket"):
			useWebsocket = True
except getopt.GetoptError:
	print(usageInfo)
	exit(1)

# Missing configuration notification
missingConfiguration = False
if not host:
	print("Missing '-e' or '--endpoint'")
	missingConfiguration = True
if not rootCAPath:
	print("Missing '-r' or '--rootCA'")
	missingConfiguration = True
if not useWebsocket:
	if not certificatePath:
		print("Missing '-c' or '--cert'")
		missingConfiguration = True
	if not privateKeyPath:
		print("Missing '-k' or '--key'")
		missingConfiguration = True
if missingConfiguration:
	exit(2)

# Configure logging
logger = logging.getLogger("AWSIoTPythonSDK.core")
logger.setLevel(logging.DEBUG)
streamHandler = logging.StreamHandler()
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
streamHandler.setFormatter(formatter)
logger.addHandler(streamHandler)

# Init AWSIoTMQTTShadowClient
myAWSIoTMQTTShadowClient = None
if useWebsocket:
	myAWSIoTMQTTShadowClient = AWSIoTMQTTShadowClient("basicShadowDeltaListener", useWebsocket=True)
	myAWSIoTMQTTShadowClient.configureEndpoint(host, 443)
	myAWSIoTMQTTShadowClient.configureCredentials(rootCAPath)
else:
	myAWSIoTMQTTShadowClient = AWSIoTMQTTShadowClient("basicShadowDeltaListener")
	myAWSIoTMQTTShadowClient.configureEndpoint(host, 8883)
	myAWSIoTMQTTShadowClient.configureCredentials(rootCAPath, privateKeyPath, certificatePath)

# AWSIoTMQTTShadowClient configuration
#myAWSIoTMQTTShadowClient.configureAutoReconnectBackoffTime(1, 32, 20)
myAWSIoTMQTTShadowClient.configureConnectDisconnectTimeout(10)  # 10 sec
myAWSIoTMQTTShadowClient.configureMQTTOperationTimeout(5)  # 5 sec

# Connect to AWS IoT
myAWSIoTMQTTShadowClient.connect()

# Create a deviceShadow with persistent subscription
Bot = myAWSIoTMQTTShadowClient.createShadowHandlerWithName("ledLights", True)

# Listen on deltas
Bot.shadowRegisterDeltaCallback(customShadowCallback_Delta)

# Config pin
GPIO.setmode(GPIO.BCM)
GPIO.setup(20, GPIO.OUT)
GPIO.output(20, GPIO.LOW)
time.sleep(0.5)
p = GPIO.PWM(20, 100)  # channel=12 frequency=50Hz
p.start(0)

# Loop forever
while True:
	pass
