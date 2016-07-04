#How to use this code

1. Go to the AWS Lambda Console and create a new lambda function
2. Setup an S3 bucket to act as the source bucket that will trigger invocations of the lambda function
3. Setup IAM roles for the bucket to be able to invoke the lambda function, and one for the lambda function to be able to read, write and modify the permissions of the objects in the S3 bucket

This is the IAM policy used in the lambda function:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:*"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl"
      ],
      "Resource": [
        "arn:aws:s3:::*"
      ]
    }
  ]
}
```

This is the IAM used to invoke the lambda function:
```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Resource": [
        "*"
      ],
      "Action": [
        "lambda:InvokeFunction"
      ]
    }
  ]
}

```
In the AWS S3 Console in the bucket property list you must configure the event dispatch from the bucket.

In the events field select `ObjectCreated(All)`
Send to Lambda function
You can check the Lambda ARN in the lambda section of the console, and the IAM role to invoke it in the IAM section of the console.
