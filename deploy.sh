#!/bin/bash

# 경로 설정
DEPLOY_DIR="/home/ec2-user/solcast-backend"
LOG_FILE="/home/ec2-user/deploy.log"
DOCKER_IMAGE="solcast-backend"
DOCKER_CONTAINER="solcast-backend"
AWS_REGION="ap-northeast-2"
AWS_ACCOUNT_ID="905418205568"

# 로그 파일 초기화
echo "Deployment started at $(date)" > $LOG_FILE

# 배포 디렉토리로 이동
cd ${DEPLOY_DIR}

# npm 및 Node.js 설치 확인
echo "Checking for Node.js and npm..." >> $LOG_FILE
if ! command -v node &> /dev/null
then
    echo "Node.js not found, installing..." >> $LOG_FILE
    curl -sL https://rpm.nodesource.com/setup_18.x | sudo -E bash - >> $LOG_FILE
    sudo rpm --import https://rpm.nodesource.com/gpgkey/nodesource.gpg.key >> $LOG_FILE
    sudo yum install -y nodejs >> $LOG_FILE
else
    echo "Node.js found: $(node -v)" >> $LOG_FILE
fi

if ! command -v npm &> /dev/null
then
    echo "npm not found, installing..." >> $LOG_FILE
    sudo yum install -y npm >> $LOG_FILE
else
    echo "npm found: $(npm -v)" >> $LOG_FILE
fi

# node_modules 디렉토리 삭제
echo "Removing node_modules directory..." >> $LOG_FILE
rm -rf node_modules

# npm install 실행
echo "Installing dependencies..." >> $LOG_FILE
npm install >> $LOG_FILE 2>&1
if [ $? -ne 0 ]; then
    echo "npm install failed" >> $LOG_FILE
    exit 1
fi

# 배포 날짜와 시간 포함 이미지 태그 생성
IMAGE_TAG=$(date +'%Y-%m-%d-%H-%M-%S')

# Docker 로그인
echo "Logging in to Amazon ECR..." >> $LOG_FILE
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com >> $LOG_FILE 2>&1
if [ $? -ne 0 ]; then
    echo "ECR login failed" >> $LOG_FILE
    exit 1
fi

# 기존 애플리케이션 종료 및 Docker 컨테이너 제거
echo "Stopping and removing existing Docker container if exists..." >> $LOG_FILE
if [ $(docker ps -a -q -f name=$DOCKER_CONTAINER) ]; then
    docker stop $DOCKER_CONTAINER
    docker rm $DOCKER_CONTAINER
fi

# 기존 Docker 이미지 제거
echo "Removing old Docker images..." >> $LOG_FILE
EXISTING_IMAGE_IDS=$(docker images --filter=reference="$DOCKER_IMAGE:*" --format "{{.ID}}")
for IMAGE_ID in $EXISTING_IMAGE_IDS; do
    docker rmi -f $IMAGE_ID >> $LOG_FILE 2>&1
    if [ $? -ne 0 ]; then
        echo "Failed to remove Docker image with ID $IMAGE_ID" >> $LOG_FILE
    fi
done

# Docker 이미지 빌드
echo "Building Docker image..." >> $LOG_FILE
docker build -t $DOCKER_IMAGE:$IMAGE_TAG . >> $LOG_FILE 2>&1
if [ $? -ne 0 ]; then
    echo "Docker image build failed" >> $LOG_FILE
    exit 1
fi

# Docker 이미지 태그 지정
ECR_IMAGE_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$DOCKER_IMAGE:$IMAGE_TAG"
echo "Tagging Docker image as $ECR_IMAGE_URI" >> $LOG_FILE
docker tag $DOCKER_IMAGE:$IMAGE_TAG $ECR_IMAGE_URI >> $LOG_FILE 2>&1
if [ $? -ne 0 ]; then
    echo "Docker image tagging failed" >> $LOG_FILE
    exit 1
fi

# Docker 이미지 ECR로 푸시
echo "Pushing Docker image to ECR..." >> $LOG_FILE
docker push $ECR_IMAGE_URI >> $LOG_FILE 2>&1
if [ $? -ne 0 ]; then
    echo "Docker image push to ECR failed" >> $LOG_FILE
    exit 1
fi

# Docker 컨테이너 실행
echo "Starting Docker container..." >> $LOG_FILE
docker run -d -p 80:3001 --name $DOCKER_CONTAINER $ECR_IMAGE_URI >> $LOG_FILE 2>&1
if [ $? -ne 0 ]; then
    echo "Docker container failed to start" >> $LOG_FILE
    exit 1
fi

echo "Deployment completed at $(date)" >> $LOG_FILE
