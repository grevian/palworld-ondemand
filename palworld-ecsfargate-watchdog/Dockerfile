# version 1.2.0

# Specify the base image
FROM --platform=linux/amd64 public.ecr.aws/aws-se/amazon-ecs-network-sidecar:latest

# Set environment variables for Go installation
ENV GO_VERSION=1.22.0
ENV RCON_VERSION=0.10.3
ENV GOPATH /go
ENV PATH $GOPATH/bin:/usr/local/go/bin:$PATH
ENV GO111MODULE on

# Set environment variables for the RCON client
ENV RCONPORT=25575
ARG RCONPASSWORD

# Set the working directory in the container
WORKDIR /app

# Install required packages
RUN yum install -y net-tools jq nmap-ncat && \
    yum clean all

# Install Go
RUN wget https://dl.google.com/go/go${GO_VERSION}.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz && \
    rm go${GO_VERSION}.linux-amd64.tar.gz && \
    mkdir -p "$GOPATH/src" "$GOPATH/bin" && chmod -R 777 "$GOPATH"

# Install the RCON package
RUN wget "https://github.com/gorcon/rcon-cli/releases/download/v${RCON_VERSION}/rcon-${RCON_VERSION}-amd64_linux.tar.gz" -O /tmp/rcon.tar.gz && \
    tar -xzf /tmp/rcon.tar.gz -C /tmp && \
    mv "/tmp/rcon-${RCON_VERSION}-amd64_linux/rcon" /usr/local/bin/rcon && \
    chmod +x /usr/local/bin/rcon && \
    rm -rf /tmp/rcon.tar.gz && \
    rm -rf "/tmp/rcon-${RCON_VERSION}-amd64_linux"

# Create the `rcon.yaml` file with the RCON server address and password
RUN printf "default:\n  address: \"localhost:%s\"\n  password: \"%s\"\n" "$RCONPORT" "${RCONPASSWORD}" > /app/rcon.yaml

# Copy the `watchdog.sh` script to the container and make it executable
COPY ./watchdog.sh .
RUN chmod +x ./watchdog.sh

# Set the entrypoint to the `watchdog.sh` script
ENTRYPOINT ["./watchdog.sh"]