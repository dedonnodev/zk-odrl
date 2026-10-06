# ODRL policy -> circom circuit -> Groth16 proof (snarkjs) -> Solidity verifier.
# DEMO ONLY: both setup phases use a public beacon, so the setup secret is
# public and anyone can forge proofs for this verifier.
# Quiet by default, full tool output with V=1 (log in build/build.log).
B := build
C := policy
WHO ?= alice
SNARKJS := npx snarkjs
BEACON := 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
SHELL := bash
.SHELLFLAGS := -o pipefail -ec
.DELETE_ON_ERROR:

ifeq ($(V),1)
run = $(1)
else
run = @{ $(1); } >> $(B)/build.log 2>&1 || { tail -n 20 $(B)/build.log; exit 1; }
endif
step = @echo "- $(1)"

.PHONY: hello deny clean
hello: $(B)/verified.txt
	@cat $<

# bob has level 2 < 3: the witness cannot be computed, so no proof
deny: $(B)/$(C).r1cs
	$(call step,bob: compute witness (must fail))
	$(call run,node scripts/policy-input.js policies/hello.json policies/bob.json > $(B)/bob.json)
	$(call run,! $(SNARKJS) wtns calculate $(B)/$(C)_js/$(C).wasm $(B)/bob.json $(B)/bob.wtns)
	@echo "bob: no proof (policy not satisfied)"

$(B):
	@mkdir -p $@

# --inspect only warns, so fail on warnings. CA02 (unused Num2Bits output bits)
# is expected: the bits are constrained inside Num2Bits.
$(B)/$(C).r1cs: circuits/$(C).circom Makefile | $(B)
	$(call step,compile circuit)
	$(call run,circom --O1 --inspect --r1cs --wasm -o $(B) $< > $(B)/inspect.log 2>&1)
	$(call run,! grep "warning\[" $(B)/inspect.log | grep -v -q "CA02")

$(B)/pot.ptau: Makefile | $(B)
	$(call step,powers of tau (phase 1))
	$(call run,$(SNARKJS) powersoftau new bn128 10 $(B)/pot0.ptau)
	$(call run,$(SNARKJS) powersoftau beacon $(B)/pot0.ptau $(B)/pot1.ptau $(BEACON) 10 -n="beacon")
	$(call run,$(SNARKJS) powersoftau prepare phase2 $(B)/pot1.ptau $@)
	@rm $(B)/pot0.ptau $(B)/pot1.ptau

$(B)/$(C).zkey: $(B)/$(C).r1cs $(B)/pot.ptau
	$(call step,groth16 setup (phase 2))
	$(call run,$(SNARKJS) groth16 setup $< $(B)/pot.ptau $(B)/z0.zkey)
	$(call run,$(SNARKJS) zkey beacon $(B)/z0.zkey $@ $(BEACON) 10 -n="beacon")
	@rm $(B)/z0.zkey

$(B)/verification_key.json: $(B)/$(C).zkey
	$(call run,$(SNARKJS) zkey export verificationkey $< $@)

contracts/Groth16Verifier.sol: $(B)/$(C).zkey
	$(call step,export solidity verifier)
	$(call run,$(SNARKJS) zkey export solidityverifier $< $@)

$(B)/input.json: policies/hello.json policies/$(WHO).json scripts/policy-input.js | $(B)
	$(call step,policy + $(WHO) attributes -> circuit input)
	$(call run,node scripts/policy-input.js policies/hello.json policies/$(WHO).json > $@)

$(B)/proof.json: $(B)/input.json $(B)/$(C).r1cs $(B)/$(C).zkey
	$(call step,witness and proof)
	$(call run,$(SNARKJS) wtns calculate $(B)/$(C)_js/$(C).wasm $< $(B)/witness.wtns)
	$(call run,$(SNARKJS) groth16 prove $(B)/$(C).zkey $(B)/witness.wtns $@ $(B)/public.json)

$(B)/verified.txt: $(B)/proof.json $(B)/verification_key.json contracts/Groth16Verifier.sol scripts/hello-onchain.js hardhat.config.js package-lock.json
	$(call step,verify with snarkjs and with the contract)
	$(call run,npx hardhat build)
	$(call run,node scripts/hello-onchain.js > $@)

clean:
	@rm -rf $(B) artifacts cache
