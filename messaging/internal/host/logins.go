package host

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"maunium.net/go/mautrix/bridgev2"
)

// LoginProc is one in-progress login. The desktop app drives it step by step:
// it shows each step, submits user input or cookies, and polls while a
// display_and_wait step (a QR code, say) waits for the network.
type LoginProc struct {
	ID     string
	Bridge string

	proc   bridgev2.LoginProcess
	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex
	step    *bridgev2.LoginStep
	err     string
	waiting bool
	done    bool
}

type LoginState struct {
	ID      string              `json:"id"`
	Network string              `json:"network"`
	Step    *bridgev2.LoginStep `json:"step,omitempty"`
	Error   string              `json:"error,omitempty"`
	Done    bool                `json:"done"`
	Account string              `json:"account,omitempty"`
}

type LoginManager struct {
	b     *Bridge
	lock  sync.Mutex
	procs map[string]*LoginProc
}

func newProcID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (lm *LoginManager) Flows() []bridgev2.LoginFlow { return lm.b.BR.Network.GetLoginFlows() }

func (lm *LoginManager) Start(flowID string) (*LoginState, error) {
	if lm.b.User == nil {
		return nil, errors.New("bridge is not started")
	}
	ctx, cancel := context.WithTimeout(lm.b.BR.BackgroundCtx, 30*time.Minute)
	proc, err := lm.b.BR.Network.CreateLogin(ctx, lm.b.User, flowID)
	if err != nil {
		cancel()
		return nil, err
	}
	step, err := proc.Start(ctx)
	if err != nil {
		cancel()
		return nil, err
	}
	lp := &LoginProc{ID: newProcID(), Bridge: lm.b.Net.ID(), proc: proc, ctx: ctx, cancel: cancel}
	lm.lock.Lock()
	lm.procs[lp.ID] = lp
	lm.lock.Unlock()
	lp.setStep(step)
	return lp.State(), nil
}

func (lm *LoginManager) Get(id string) (*LoginProc, error) {
	lm.lock.Lock()
	defer lm.lock.Unlock()
	lp, ok := lm.procs[id]
	if !ok {
		return nil, fmt.Errorf("unknown login %q", id)
	}
	return lp, nil
}

func (lm *LoginManager) Cancel(id string) {
	lm.lock.Lock()
	lp, ok := lm.procs[id]
	delete(lm.procs, id)
	lm.lock.Unlock()
	if ok {
		lp.proc.Cancel()
		lp.cancel()
	}
}

// Submit sends the person's answer to the current step: input fields for a
// user_input step, or cookie values for a cookies step.
func (lp *LoginProc) Submit(values map[string]string) (*LoginState, error) {
	lp.mu.Lock()
	step := lp.step
	lp.mu.Unlock()
	if step == nil || lp.done {
		return nil, errors.New("login is not waiting for input")
	}
	var next *bridgev2.LoginStep
	var err error
	switch step.Type {
	case bridgev2.LoginStepTypeUserInput:
		p, ok := lp.proc.(bridgev2.LoginProcessUserInput)
		if !ok {
			return nil, errors.New("login does not accept user input")
		}
		next, err = p.SubmitUserInput(lp.ctx, values)
	case bridgev2.LoginStepTypeCookies:
		p, ok := lp.proc.(bridgev2.LoginProcessCookies)
		if !ok {
			return nil, errors.New("login does not accept cookies")
		}
		next, err = p.SubmitCookies(lp.ctx, values)
	default:
		return nil, fmt.Errorf("step %s does not take input", step.Type)
	}
	if err != nil {
		lp.mu.Lock()
		lp.err = err.Error()
		lp.mu.Unlock()
		return lp.State(), nil
	}
	lp.setStep(next)
	return lp.State(), nil
}

func (lp *LoginProc) setStep(step *bridgev2.LoginStep) {
	lp.mu.Lock()
	lp.step = step
	lp.err = ""
	if step != nil && step.Type == bridgev2.LoginStepTypeComplete {
		lp.done = true
	}
	startWait := step != nil && step.Type == bridgev2.LoginStepTypeDisplayAndWait && !lp.waiting
	if startWait {
		lp.waiting = true
	}
	lp.mu.Unlock()
	if startWait {
		go lp.wait()
	}
}

func (lp *LoginProc) wait() {
	p, ok := lp.proc.(bridgev2.LoginProcessDisplayAndWait)
	if !ok {
		return
	}
	next, err := p.Wait(lp.ctx)
	lp.mu.Lock()
	lp.waiting = false
	if err != nil {
		lp.err = err.Error()
		lp.mu.Unlock()
		return
	}
	lp.mu.Unlock()
	lp.setStep(next)
}

func (lp *LoginProc) State() *LoginState {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	st := &LoginState{ID: lp.ID, Network: lp.Bridge, Step: lp.step, Error: lp.err, Done: lp.done}
	if lp.done && lp.step != nil && lp.step.CompleteParams != nil {
		st.Account = AccountID(lp.Bridge, string(lp.step.CompleteParams.UserLoginID))
	}
	return st
}
