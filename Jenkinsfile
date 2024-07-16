pipeline {
   agent any

   environment {
       S3PATH = "${env.JOB_NAME}"
       AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
   }
   tools {
      nodejs "NodeJS 20.14.0"
   }

   stages {
      stage('Check Out') {
         steps {
            git branch: 'master', url: 'https://github.com/padojin/solcast-backend.git'
         }
      }

      stage('Install dependencies') {
          steps {
              sh 'npm ci'
          }
      }
      stage('Create Zip Archive') {
          steps {
              sh 'zip -r backend.zip . -x "node_modules/*" -x ".git/*"'
          }
      }
      stage('Upload S3') {
          steps {
              echo 'Upload S3'
              withAWS(credentials: '4b19d56f-8b5a-4249-a934-b669519977e7') {
                  s3Upload(file: 'backend.zip', bucket: 'solcast-backend-bucket', path: "${S3PATH}/backend.zip")
              }
          }
      }
      stage('Deploy') {
          steps {
              echo 'deploy'
              step([$class: 'AWSCodeDeployPublisher', 
                    applicationName: 'solcast', 
                    awsAccessKey: 'AKIA5FTZBNGAD22XVD4M', 
                    awsSecretKey: AWS_SECRET_ACCESS_KEY, 
                    credentials: 'awsAccessKey', 
                    deploymentConfig: 'CodeDeployDefault.OneAtATime', 
                    deploymentGroupAppspec: false, 
                    deploymentGroupName: 'solcast-was-deploy', 
                    excludes: '', 
                    iamRoleArn: '', 
                    includes: '**', 
                    proxyHost: '', 
                    proxyPort: 0, 
                    region: 'ap-northeast-2', 
                    s3bucket: 'solcast-backend-bucket', 
                    s3prefix: 'solcast-backend/', 
                    subdirectory: '', 
                    versionFileName: '', 
                    waitForCompletion: false
              ])
          }
      }

   }
   post {
        success {
            echo 'successed'
        }
        failure {
            echo 'failed'
        }
   }
}
