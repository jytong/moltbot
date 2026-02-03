#!/bin/bash
#
# Sync changed files in specified directory to Tencent Cloud COS
# This script is called by post-commit hook
#
# Configuration in .cos.env:
#   COS_SYNC_DIR - Directory to sync (default: packages)
#   COS_CDN_URL  - CDN URL for cache refresh (optional)
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

# Generate CDN API signature (TC3-HMAC-SHA256)
generate_cdn_signature() {
    local timestamp="$1"
    local payload="$2"
    local service="cdn"
    local host="cdn.tencentcloudapi.com"
    local date=$(date -u -d "@$timestamp" +%Y-%m-%d 2>/dev/null || date -u -r "$timestamp" +%Y-%m-%d)

    # Canonical request
    local http_method="POST"
    local canonical_uri="/"
    local canonical_querystring=""
    local content_type="application/json"
    local payload_hash=$(echo -n "$payload" | openssl dgst -sha256 | awk '{print $2}')
    local canonical_headers="content-type:$content_type\nhost:$host\nx-tc-action:purgeurlscache\n"
    local signed_headers="content-type;host;x-tc-action"
    local canonical_request="${http_method}\n${canonical_uri}\n${canonical_querystring}\n${canonical_headers}\n${signed_headers}\n${payload_hash}"
    local hashed_canonical_request=$(echo -en "$canonical_request" | openssl dgst -sha256 | awk '{print $2}')

    # String to sign
    local algorithm="TC3-HMAC-SHA256"
    local credential_scope="${date}/${service}/tc3_request"
    local string_to_sign="${algorithm}\n${timestamp}\n${credential_scope}\n${hashed_canonical_request}"

    # Signing key
    local secret_date=$(echo -n "$date" | openssl dgst -sha256 -hmac "TC3${COS_SECRET_KEY}" | awk '{print $2}')
    local secret_service=$(echo -n "$service" | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$secret_date" | awk '{print $2}')
    local secret_signing=$(echo -n "tc3_request" | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$secret_service" | awk '{print $2}')
    local signature=$(echo -en "$string_to_sign" | openssl dgst -sha256 -mac HMAC -macopt hexkey:"$secret_signing" | awk '{print $2}')

    echo "${algorithm} Credential=${COS_SECRET_ID}/${credential_scope}, SignedHeaders=${signed_headers}, Signature=${signature}"
}

# Function to refresh CDN cache for a URL
refresh_cdn_cache() {
    local url="$1"
    local timestamp=$(date +%s)
    local payload="{\"Urls\":[\"$url\"]}"

    local authorization=$(generate_cdn_signature "$timestamp" "$payload")

    local response=$(curl -s -X POST "https://cdn.tencentcloudapi.com" \
        -H "Authorization: $authorization" \
        -H "Content-Type: application/json" \
        -H "Host: cdn.tencentcloudapi.com" \
        -H "X-TC-Action: PurgeUrlsCache" \
        -H "X-TC-Version: 2018-06-06" \
        -H "X-TC-Timestamp: $timestamp" \
        -H "X-TC-Region: $COS_REGION" \
        -d "$payload")

    if echo "$response" | grep -q '"TaskId"'; then
        return 0
    else
        log_warn "CDN refresh response: $response"
        return 1
    fi
}

# Sync changed files (upload or delete)
UPLOAD_COUNT=0
DELETE_COUNT=0
FAILED_COUNT=0
CDN_URLS_TO_REFRESH=()  # Array to store URLs for CDN refresh

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

    # Build CDN URL for refresh
    if [ -n "$COS_CDN_URL" ]; then
        cdn_url="${COS_CDN_URL%/}/$remote_path"
    fi

    # Check if file was deleted
    if [ ! -f "$local_path" ]; then
        log_info "Deleting from COS: $remote_path"

        if [ "$USE_CURL" = true ]; then
            if delete_with_curl "$remote_path"; then
                log_info "Deleted: $remote_path"
                ((DELETE_COUNT++)) || true
                # Add to CDN refresh list
                if [ -n "$cdn_url" ]; then
                    echo "$cdn_url" >> /tmp/cos_cdn_refresh_$$
                fi
            else
                log_error "Failed to delete: $remote_path"
                ((FAILED_COUNT++)) || true
            fi
        else
            if delete_with_coscli "$remote_path"; then
                log_info "Deleted: $remote_path"
                ((DELETE_COUNT++)) || true
                # Add to CDN refresh list
                if [ -n "$cdn_url" ]; then
                    echo "$cdn_url" >> /tmp/cos_cdn_refresh_$$
                fi
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
            # Add to CDN refresh list
            if [ -n "$cdn_url" ]; then
                echo "$cdn_url" >> /tmp/cos_cdn_refresh_$$
            fi
        else
            log_error "Failed to upload: $file"
            ((FAILED_COUNT++)) || true
        fi
    else
        if upload_with_coscli "$local_path" "$remote_path"; then
            log_info "Uploaded: $file"
            ((UPLOAD_COUNT++)) || true
            # Add to CDN refresh list
            if [ -n "$cdn_url" ]; then
                echo "$cdn_url" >> /tmp/cos_cdn_refresh_$$
            fi
        else
            log_error "Failed to upload: $file"
            ((FAILED_COUNT++)) || true
        fi
    fi
done

log_info "Sync complete."

# Refresh CDN cache for changed files
if [ -n "$COS_CDN_URL" ] && [ -f /tmp/cos_cdn_refresh_$$ ]; then
    log_info "Refreshing CDN cache..."
    while read -r cdn_url; do
        if [ -n "$cdn_url" ]; then
            log_info "Refreshing: $cdn_url"
            if refresh_cdn_cache "$cdn_url"; then
                log_info "CDN refreshed: $cdn_url"
            else
                log_warn "CDN refresh may have failed: $cdn_url"
            fi
        fi
    done < /tmp/cos_cdn_refresh_$$
    rm -f /tmp/cos_cdn_refresh_$$
    log_info "CDN refresh complete."
fi
