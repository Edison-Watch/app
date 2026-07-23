#!/usr/bin/env bash
# Creates a visual test run and uploads a tar archive to the visual-tests service.
#
# Usage:
#   upload-visual-run.sh <project> <tar_file> <auto_approve> <branch> <base_branch> <commit_sha> <repo> <pr_number>
#
# Required env vars: VISUAL_TESTS_URL, VISUAL_TESTS_API_KEY

set -euo pipefail

PROJECT="$1"
TAR_FILE="$2"
AUTO_APPROVE="$3"
BRANCH="$4"
BASE_BRANCH="$5"
COMMIT_SHA="$6"
REPO="$7"
PR_NUMBER="${8:-null}"

if [ -z "${VISUAL_TESTS_URL:-}" ] || [ -z "${VISUAL_TESTS_API_KEY:-}" ]; then
  echo "::notice::Visual tests service not configured - skipping upload"
  exit 0
fi

if [ ! -f "$TAR_FILE" ]; then
  echo "::warning::No archive found at $TAR_FILE - skipping upload"
  exit 0
fi

echo "Project: $PROJECT | Branch: $BRANCH | Base: $BASE_BRANCH | Auto-approve: $AUTO_APPROVE | PR: $PR_NUMBER"

PR_ARG=$([ "$PR_NUMBER" = "null" ] && echo "null" || echo "$PR_NUMBER")
PAYLOAD=$(jq -n \
  --arg     commit       "$COMMIT_SHA" \
  --arg     branch       "$BRANCH" \
  --arg     base_branch  "$BASE_BRANCH" \
  --arg     repo         "$REPO" \
  --argjson pr_number    "$PR_ARG" \
  --arg     project      "$PROJECT" \
  --argjson auto_approve "$AUTO_APPROVE" \
  '{commit: $commit, branch: $branch, base_branch: $base_branch, repo: $repo,
    pr_number: $pr_number, project: $project, auto_approve: $auto_approve}')

# Create run - retry for up to 10 minutes for transient failures like 502
RUN_ID=""
DEADLINE=$((SECONDS + 600))
RETRY_DELAY=10
while true; do
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$VISUAL_TESTS_URL/api/runs" \
    -H "Authorization: Bearer $VISUAL_TESTS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  RUN_ID=$(echo "$BODY" | jq -r '.run_id // empty')
  if [ -n "$RUN_ID" ]; then
    break
  fi
  echo "Failed to create visual test run (HTTP $HTTP_CODE): $BODY"
  REMAINING=$((DEADLINE - SECONDS))
  if [ $REMAINING -le 0 ]; then
    break
  fi
  SLEEP=$((RETRY_DELAY < REMAINING ? RETRY_DELAY : REMAINING))
  echo "Retrying in ${SLEEP}s (${REMAINING}s remaining)..."
  sleep "$SLEEP"
  RETRY_DELAY=$(( RETRY_DELAY * 2 < 120 ? RETRY_DELAY * 2 : 120 ))
done

if [ -z "$RUN_ID" ]; then
  echo "::warning::Visual tests service unavailable after 10 min - skipping upload"
  exit 0
fi
echo "Created run: $RUN_ID"

for attempt in 1 2 3; do
  UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$VISUAL_TESTS_URL/api/runs/$RUN_ID/upload" \
    -H "Authorization: Bearer $VISUAL_TESTS_API_KEY" \
    -F "screenshots=@$TAR_FILE")
  UPLOAD_HTTP=$(echo "$UPLOAD_RESPONSE" | tail -1)
  UPLOAD_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')
  if [ "$UPLOAD_HTTP" -ge 200 ] && [ "$UPLOAD_HTTP" -lt 300 ]; then
    echo "Upload result: $UPLOAD_BODY"
    break
  fi
  echo "Upload attempt $attempt failed (HTTP $UPLOAD_HTTP): $UPLOAD_BODY"
  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 5))
  else
    echo "::error::Upload failed after 3 attempts (HTTP $UPLOAD_HTTP): $UPLOAD_BODY"
    exit 1
  fi
done
