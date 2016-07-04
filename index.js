// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true });
var s3 = new AWS.S3();
var sqs = new AWS.SQS();
var util = require('util');

var timestamp = new Date().getTime();
var timestampKey = null;

exports.handler = function(event, context) {
	console.log('Reading options from event:\n', util.inspect(event, {
		depth: 5
	}));

	var srcBucket = event.Records[0].s3.bucket.name;
	var srcKey = event.Records[0].s3.object.key;

	var environment = srcBucket.indexOf('-production') > -1 ? 'production' : 'development';

	var dstBucket = srcBucket;
	var dstKey = srcKey;

	var fileType = '';

	var width = null;
	var height = null;
	var acl = null;
	var metadata = null;
	var queueEvent = null;
	var queueUrl = null;
	var tags = null;

	// Infer the image type
	var typeMatch = srcKey.match(/\.([^.]*)$/);
	if (!typeMatch) {
		console.error('Unable to infer image type for key ' + srcKey);
		return;
	}

	fileType = typeMatch[1].toLowerCase();
	if (fileType != 'jpg' && fileType != 'png') {
		console.log('Skipping non-image ' + srcKey);
		return;
	}

	// Download the image from S3, transform, and overwrite if changes were made
	async.waterfall([
		function download(next) {
			s3.getObject({
					Bucket: srcBucket,
					Key: srcKey
				},
				function(err, response) {
					if (response && response.ACL) {
						acl = response.ACL;
					}

					if (response && response.Metadata) {
						metadata = response.Metadata;
						if (metadata['autoorient-timestamp'] && metadata['autocrop-timestamp']) {
							context.done();
							console.log('Image has already been auto oriented using exif metadata and no further automatic transformations were resolved');
							return;
						}

						queueEvent = metadata['sqs-queue-event'];
						queueUrl = metadata['sqs-queue-url'];
					}

					next(err, response);
				});
		},
		function transform(response, next) {
			// Transform the image buffer in memory
			gm(response.Body).orientation(function(err, value) {
				if (value === 'Undefined') {
					console.log('Image does not contain exif orientation metadata');
					next(null, response.ContentType, response.Body);
				} else {
					timestampKey = 'autoorient-timestamp';
					tags = metadata['tags'];

					var img = null;

					if (metadata) {
						if (!metadata['autocrop-timestamp'] && !metadata['autoorient-timestamp']) {
							console.log('Auto orienting image using exif metadata', value);
							img = this.autoOrient();
						} else if (!metadata['autocrop-timestamp']) {
							timestampKey = 'autocrop-timestamp';
							var isProfileImage = tags && tags.indexOf('profile_image') > -1;
							if (isProfileImage) {
								console.log('Resizing and cropping profile image', value);

								var typeIndex = dstKey.lastIndexOf('.');
								dstKey = typeIndex > -1 ? dstKey.substring(0, typeIndex) + '-square' + dstKey.substring(typeIndex): dstKey;
								console.log('Updated target destination key for resized and cropped profile image', dstKey);

								img = this.resize(300, 300, "^")
										 .gravity("Center")
										 .extent(300, 300);
							}
						}

						if (img) {
							img.toBuffer(fileType, function(err, buffer) {
								if (err) {
									next(err);
								} else {
									next(null, response.ContentType, buffer);
								}
							});
						} else {
							context.done();
							console.log('Image has already been auto oriented using exif metadata and no further automatic transformations could be applied');
							return;
						}
					}
				}
			});
		},
		function calculateDimensions(contentType, data, next) {
			gm(data).size(function(err, size) {
				if (err) {
					next(err);
				} else {
					width = size.width;
					height = size.height;
					next(null, contentType, data);
				}
			});
		},
		function upload(contentType, data, next) {
			// Stream the transformed image to a different S3 bucket
			console.log('Resolved image dimensions; width: ' + width.toString() + '; height: ' + height.toString());

			metadata.width = width.toString();
			metadata.height = height.toString();

			console.log('Setting timestamp key: ' + timestampKey);
			metadata[timestampKey] = timestamp.toString();

			if (timestampKey) {
				metadata[timestampKey] = timestamp.toString();
			}

			if (tags) {
				metadata.tags = tags;
			}

			s3.putObject({
				Bucket: dstBucket,
				Key: dstKey,
				Body: data,
				ContentType: contentType,
				ACL: acl,
				Metadata: metadata
			}, function(err, data) {
				next(err, data);
			});
		},
		function writeToQueue(data, next) {
			if (queueUrl && (srcKey != dstKey || queueEvent)) {
				var sqsPayload = {
					event: queueEvent || 's3_object_version_added',
					payload: {
						height: height,
						width: width,
						original_key: srcKey,
						version_key: dstKey,
						url: 'https://s3.amazonaws.com/' + dstBucket + '/' + dstKey,
						metadata: metadata
					}
				};

				var json = JSON.stringify(sqsPayload);
				console.log('Sending message to SQS: ' + json);

				sqs.sendMessage({
					MessageBody: json,
					QueueUrl: queueUrl
				}, function(err, data) {
					if (err) {
						console.error(err);
						next(err);
					} else {
						console.error('SQS write successful');
						next(null);
					}
				});
			} else {
				console.error('SQS write skipped');
				next(null);
			}
		}
	], function(err) {
		if (err) {
			console.log(err)
			context.fail(srcBucket + '/' + srcKey);
		} else {
			context.succeed(srcBucket + '/' + srcKey);
		}
	});
};
