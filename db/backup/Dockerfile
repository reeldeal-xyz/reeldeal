# pg_dump 16 (matches the server) plus the AWS CLI; credentials come from the EC2 instance role.
FROM postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
RUN apk add --no-cache aws-cli tzdata
COPY backup.sh schedule.sh /usr/local/bin/
CMD ["schedule.sh"]
