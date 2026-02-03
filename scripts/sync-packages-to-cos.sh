#!/bin/bash
#
# Sync changed files in specified directory to Tencent Cloud COS
# This script is called by post-commit hook
#
# Configuration in .cos.env:
#   COS_SYNC_DIR - Directory to sync (default: packages)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/.cos.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[COS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[COS]${NC} $1"
}

log_error() {
    echo -e "${RED}[COS]${NC} $1"
}

# Load configuration
if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Config file not found: $CONFIG_FILE"
    log_error "Please create .cos.env with COS credentials"
    exit 1
fi

source "$CONFIG_FILE"

# Validate required variables
if [ -z "$COS_SECRET_ID" ] || [ -z "$COS_SECRET_KEY" ] || [ -z "$COS_REGION" ] || [ -z "$COS_BUCKET" ]; then
    log_error "Missing required COS configuration in $CONFIG_FILE"
    log_error "Required: COS_SECRET_ID, COS_SECRET_KEY, COS_REGION, COS_BUCKET"
    exit 1
fi

# Set sync directory (default: packages)
SYNC_DIR="${COS_SYNC_DIR:-packages}"

# Get changed files in sync directory from the last commit
cd "$PROJECT_ROOT"

CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD -- "$SYNC_DIR/" 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
    log_info "No changes in $SYNC_DIR/ directory"
    exit 0
fi

log_info "Changed files in $SYNC_DIR/:"
echo "$CHANGED_FILES" | while read -r file; do
    echo "  - $file"
done

# Check if coscli is installed
if ! command -v coscli &> /dev/null; then
    log_warn "coscli not found. Attempting to use curl for upload..."
    USE_CURL=true
else
    USE_CURL=false
fi

# Function to upload file using coscli
upload_with_coscli() {
    local local_path="$1"
    local remote_path="$2"

    coscli cp "$local_path" "cos://$COS_BUCKET/$remote_path" \
        --secret-id "$COS_SECRET_ID" \
        --secret-key "$COS_SECRET_KEY" \
        --region "$COS_REGION"
}

# Function to delete file using coscli
delete_with_coscli() {
    local remote_path="$1"

    coscli rm "cos://$COS_BUCKET/$remote_path" \
        --secret-id "$COS_SECRET_ID" \
        --secret-key "$COS_SECRET_KEY" \
        --region "$COS_REGION"
}

# Function to generate COS signature for curl upload
generate_cos_signature() {
    local http_method="$1"
    local uri_path="$2"
    local timestamp="$3"
    local key_time="$timestamp;$((timestamp + 3600))"

    # Sign key
    local sign_key=$(echo -n "$key_time" | openssl dgst -sha1 -hmac "$COS_SECRET_KEY" | awk '{print $2}')

    # HTTP string
    local http_string="${http_method}\n${uri_path}\n\n\n"
    local sha1_http_string=$(echo -en "$http_string" | openssl dgst -sha1 | awk '{print $2}')

    # String to sign
    local string_to_sign="sha1\n${key_time}\n${sha1_http_string}\n"
    local signature=$(echo -en "$string_to_sign" | openssl dgst -sha1 -hmac "$sign_key" | awk '{print $2}')

    echo "q-sign-algorithm=sha1&q-ak=$COS_SECRET_ID&q-sign-time=$key_time&q-key-time=$key_time&q-header-list=&q-url-param-list=&q-signature=$signature"
}

# Function to upload file using curl
upload_with_curl() {
    local local_path="$1"
    local remote_path="$2"

    local timestamp=$(date +%s)
    local uri_path="/$remote_path"
    local url="https://$COS_BUCKET.cos.$COS_REGION.myqcloud.com$uri_path"

    local authorization=$(generate_cos_signature "put" "$uri_path" "$timestamp")

    curl -s -X PUT "$url" \
        -H "Authorization: $authorization" \
        -H "Content-Type: application/octet-stream" \
        --data-binary "@$local_path"
}

# Function to delete file using curl
delete_with_curl() {
    local remote_path="$1"

    local timestamp=$(date +%s)
    local uri_path="/$remote_path"
    local url="https://$COS_BUCKET.cos.$COS_REGION.myqcloud.com$uri_path"

    local authorization=$(generate_cos_signature "delete" "$uri_path" "$timestamp")

    curl -s -X DELETE "$url" \
        -H "Authorization: $authorization"
}

# Sync changed files (upload or delete)
UPLOAD_COUNT=0
DELETE_COUNT=0
FAILED_COUNT=0

echo "$CHANGED_FILES" | while read -r file; do
    if [ -z "$file" ]; then
        continue
    fi

    local_path="$PROJECT_ROOT/$file"

    # Build remote path with prefix
    if [ -n "$COS_PREFIX" ]; then
        remote_path="$COS_PREFIX/$file"
    else
        remote_path="$file"
    fi

    # Check if file was deleted
    if [ ! -f "$local_path" ]; then
        log_info "Deleting from COS: $remote_path"

        if [ "$USE_CURL" = true ]; then
            if delete_with_curl "$remote_path"; then
                log_info "Deleted: $remote_path"
                ((DELETE_COUNT++)) || true
            else
                log_error "Failed to delete: $remote_path"
                ((FAILED_COUNT++)) || true
            fi
        else
            if delete_with_coscli "$remote_path"; then
                log_info "Deleted: $remote_path"
                ((DELETE_COUNT++)) || true
            else
                log_error "Failed to delete: $remote_path"
                ((FAILED_COUNT++)) || true
            fi
        fi
        continue
    fi

    log_info "Uploading: $file -> $remote_path"

    if [ "$USE_CURL" = true ]; then
        if upload_with_curl "$local_path" "$remote_path"; then
            log_info "Uploaded: $file"
            ((UPLOAD_COUNT++)) || true
        else
            log_error "Failed to upload: $file"
            ((FAILED_COUNT++)) || true
        fi
    else
        if upload_with_coscli "$local_path" "$remote_path"; then
            log_info "Uploaded: $file"
            ((UPLOAD_COUNT++)) || true
        else
            log_error "Failed to upload: $file"
            ((FAILED_COUNT++)) || true
        fi
    fi
done

log_info "Sync complete."
