#!/usr/bin/env bash
# gpu-lock: lets one GPU-heavy job run at a time (headless Chrome for e2e, perf and captures) across processes.
#
#   tools/gpu-lock.sh <command> [args…]   waits for a free slot, runs the command, returns its exit status
#   tools/gpu-lock.sh --status            shows who holds the lock and who is waiting
#
# Settings (environment):
#   GPU_LOCK_DIR      the lock folder (default: <repo>/assets-src/tmp/gpu-lock, gitignored)
#   GPU_LOCK_SLOTS    jobs that may run at once (default 1)
#   GPU_LOCK_TIMEOUT  seconds to wait before giving up with exit 75 (default 1800)
#   GPU_LOCK_POLL     seconds between tries (default 2)
# The command runs with GPU_LOCK_HELD=1 exported, so a tool can tell its own lock from a busy GPU. A gpu-lock started
# from inside a command that holds this lock folder runs its command at once: wrapping twice never waits on itself.
#
# Waiters are served first come, first served. A holder or waiter whose process has gone (crash, kill -9) is dropped
# by the next process that looks. INT, TERM and HUP stop the command (TERM) before the lock is let go.
# Exit status: the command's own; 64 usage, 70 unusable lock folder, 75 timed out, 129 / 130 / 143 on HUP / INT / TERM.
#
# Inside the folder every entry is a symlink whose target names its process as "<pid>@<start time>", so an entry is
# created atomically with its owner and a recycled PID never passes for the old process:
#   hold.<n>     slot n is taken          line/<number>  a waiter's place in the queue (lowest number goes first)
#   gate         a short mutex held while a process inspects and changes the folder
set -u

usage() {
  cat <<'EOF'
usage: tools/gpu-lock.sh <command> [args...]     run <command> once a GPU slot is free
       tools/gpu-lock.sh --status                list holders and waiters
env:   GPU_LOCK_DIR (lock folder), GPU_LOCK_SLOTS (1), GPU_LOCK_TIMEOUT (1800 s, then exit 75), GPU_LOCK_POLL (2 s)
       the command sees GPU_LOCK_HELD=1; a nested gpu-lock inside it runs straight away
EOF
}

whole() { case "$1" in '' | *[!0-9]*) echo "$2" ;; *) echo "$1" ;; esac; }
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${GPU_LOCK_DIR:-$repo/assets-src/tmp/gpu-lock}"
SLOTS="$(whole "${GPU_LOCK_SLOTS:-}" 1)"
LIMIT="$(whole "${GPU_LOCK_TIMEOUT:-}" 1800)"
NAP="${GPU_LOCK_POLL:-2}"

# ---- processes ---------------------------------------------------------------------------------------------------
# "<pid>@<start time>" of a running process; empty once it has exited. The time is printed in a fixed locale and zone, so
# every process writes and reads the same text whatever its own environment.
ident() {
  local started
  started="$(LC_ALL=C TZ=UTC0 ps -o lstart= -p "$1" 2>/dev/null)" || return 0
  started="$(echo $started)"
  [ -n "$started" ] && printf '%s@%s' "$1" "${started// /_}"
}
alive() { [ -n "$1" ] && [ "$(ident "${1%%@*}")" = "$1" ]; }
cmd_of() { ps -ww -o command= -p "$1" 2>/dev/null | sed 's/^[^ ]* [^ ]*gpu-lock\.sh //' | cut -c1-110; }

# ---- the folder ---------------------------------------------------------------------------------------------------
describe() { # one line about the process an entry names
  local who="$1" pid="${1%%@*}" when="${1#*@}"
  if alive "$who"; then echo "pid $pid, started ${when//_/ } UTC: $(cmd_of "$pid")"; else echo "pid $pid (gone)"; fi
}
status() {
  local link who n=0 any=
  for link in "$LOCK"/hold.[0-9]*; do
    who="$(readlink "$link" 2>/dev/null)" || continue
    any=1; echo "${link##*/}: $(describe "$who")"
  done
  [ -n "$any" ] || echo "gpu-lock: free ($LOCK)"
  for link in "$LOCK"/line/[0-9]*; do
    who="$(readlink "$link" 2>/dev/null)" || continue
    n=$((n + 1)); echo "queue $n: $(describe "$who")"
  done
}

if [ "${1:-}" = "--status" ]; then status; exit 0; fi
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 64; fi

mkdir -p "$LOCK/line" 2>/dev/null && [ -w "$LOCK" ] && [ -w "$LOCK/line" ] \
  || { echo "gpu-lock: cannot use the lock folder $LOCK" >&2; exit 70; }
ME="$(ident $$)"
[ -n "$ME" ] || { echo "gpu-lock: cannot read this process's start time (ps)" >&2; exit 70; }

# ---- nesting: an ancestor of this process holds a slot here, so this command already runs inside the lock --------
enclosing_hold() {
  local chain=" " pid=$PPID link who
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    chain="$chain$pid "
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  done
  for link in "$LOCK"/hold.[0-9]*; do
    who="$(readlink "$link" 2>/dev/null)" || continue
    case "$chain" in *" ${who%%@*} "*) alive "$who" && { echo "${link##*/}, pid ${who%%@*}"; return 0; } ;; esac
  done
  return 1
}
if outer="$(enclosing_hold)"; then
  echo "gpu-lock: already inside the lock ($outer); running directly" >&2
  export GPU_LOCK_HELD=1
  exec "$@"
fi

# ---- state and clean-up -------------------------------------------------------------------------------------------
GATE="$LOCK/gate"
ticket=""   # my place in line/ while waiting
mine=""     # the hold.<n> link once acquired
child=""    # the running command
napper=""   # the sleep between tries

ours() { [ -n "$1" ] && [ "$(readlink "$1" 2>/dev/null)" = "$ME" ]; }
let_go() { # remove every entry that names this process (also one made just before a signal landed)
  local link
  [ -n "$napper" ] && kill "$napper" 2>/dev/null
  for link in "$LOCK"/hold.[0-9]* "$LOCK"/line/[0-9]* "$GATE"; do ours "$link" && rm -f "$link"; done
  ticket=""; mine=""; napper=""
}
stop() { # $1 = exit status. Stop the command first: the slot is free only once the GPU job is gone.
  trap '' INT TERM HUP
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null
    local k=0
    while kill -0 "$child" 2>/dev/null && [ "$k" -lt 100 ]; do sleep 0.1; k=$((k + 1)); done
    kill -KILL "$child" 2>/dev/null
  fi
  exit "$1"
}
trap let_go EXIT
trap 'stop 129' HUP
trap 'stop 130' INT
trap 'stop 143' TERM

# ---- the gate: every look at the holders and the queue happens inside it, so two processes never race there ------
gate_in() {
  local who aside
  until ln -sn "$ME" "$GATE" 2>/dev/null; do
    who="$(readlink "$GATE" 2>/dev/null)"
    if [ -n "$who" ] && ! alive "$who"; then
      # its owner died inside: move the link aside first, so only one process clears it, and give back a live one
      aside="$GATE.$$"
      if mv -f "$GATE" "$aside" 2>/dev/null; then
        [ "$(readlink "$aside")" = "$who" ] || ln -sn "$(readlink "$aside")" "$GATE" 2>/dev/null
        rm -f "$aside"
      fi
      continue
    fi
    [ -d "$LOCK/line" ] || mkdir -p "$LOCK/line" 2>/dev/null   # (the folder was cleared under us)
    [ "$SECONDS" -lt "$LIMIT" ] || return 1
    sleep 0.05
  done
}
gate_out() { ours "$GATE" && rm -f "$GATE"; }

join_line() { # take the number after the highest one in the queue
  local link top=0 base
  for link in "$LOCK"/line/[0-9]*; do
    base="${link##*/}"
    case "$base" in *[!0-9]*) continue ;; esac
    [ -L "$link" ] && top=$((10#$base))
  done
  ticket="$LOCK/line/$(printf '%09d' $((top + 1)))"
  ln -sn "$ME" "$ticket" 2>/dev/null || ticket=""
}

# One try (inside the gate). Sets `ahead` (live waiters in front of me); returns 0 once a slot is mine.
ahead=0
try_take() {
  local n link who open="" nfree=0
  for ((n = 0; n < SLOTS; n++)); do
    link="$LOCK/hold.$n"
    if who="$(readlink "$link" 2>/dev/null)"; then
      alive "$who" && continue
      echo "gpu-lock: reclaiming stale hold.$n (pid ${who%%@*} gone)" >&2
      rm -f "$link"
    fi
    nfree=$((nfree + 1)); [ -n "$open" ] || open="$link"
  done
  ours "$ticket" || join_line
  ahead=0
  if [ -n "$ticket" ]; then
    for link in "$LOCK"/line/[0-9]*; do
      [ "$link" = "$ticket" ] && break
      who="$(readlink "$link" 2>/dev/null)" || continue
      if alive "$who"; then ahead=$((ahead + 1)); else rm -f "$link"; fi
    done
  fi
  [ "$ahead" -lt "$nfree" ] && ln -sn "$ME" "$open" 2>/dev/null || return 1
  mine="$open"
  rm -f "$ticket"; ticket=""
}

first_busy() {
  local link who
  for link in "$LOCK"/hold.[0-9]*; do
    who="$(readlink "$link" 2>/dev/null)" && alive "$who" && { cmd_of "${who%%@*}"; return; }
  done
  echo unknown
}

# ---- wait for a slot ----------------------------------------------------------------------------------------------
SECONDS=0
tries=0
noted=-60
while :; do
  if gate_in; then
    try_take; got=$?
    gate_out
    [ "$got" -eq 0 ] && break
  fi
  tries=$((tries + 1))
  if [ "$SECONDS" -ge "$LIMIT" ]; then
    { echo "gpu-lock: timed out after ${SECONDS}s waiting for a GPU slot; holders:"; status; } >&2
    exit 75
  fi
  if [ $((SECONDS - noted)) -ge 60 ]; then
    echo "gpu-lock: waiting (${SECONDS}s, $((ahead + 1)) in the queue) — busy: $(first_busy)" >&2
    noted=$SECONDS
  fi
  sleep "$NAP" & napper=$!
  wait "$napper" 2>/dev/null; napper=""
done
[ "$tries" -gt 0 ] && [ "$SECONDS" -gt 0 ] && echo "gpu-lock: acquired ${mine##*/} after ${SECONDS}s" >&2

# ---- run the command (in the background, so a signal reaches the trap at once; stdin stays the caller's) ----------
export GPU_LOCK_HELD=1
if { : <&0; } 2>/dev/null; then "$@" <&0 & else "$@" & fi
child=$!
wait "$child"
rc=$?
child=""
let_go
exit "$rc"
