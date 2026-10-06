pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// One ODRL constraint "attribute gteq threshold".
// attribute is private, threshold is public.
template PolicyGteq() {
    signal input attribute;
    signal input threshold;

    // LessThan(64) is only correct on values below 2^64
    component a = Num2Bits(64);
    a.in <== attribute;
    component t = Num2Bits(64);
    t.in <== threshold;

    component ge = GreaterEqThan(64);
    ge.in[0] <== attribute;
    ge.in[1] <== threshold;
    ge.out === 1;
}

component main {public [threshold]} = PolicyGteq();
