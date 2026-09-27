(function(){
  "use strict";

  // Accurate per-country default rates for online invoicing.
  // pct = percentage fee, fixed = fixed fee in that country's currency.
  var RATES = {
    us: {
      symbol: "$",
      stripe: { pct: 2.9,  fixed: 0.30 },
      paypal: { pct: 3.49, fixed: 0.49 },
      square: { pct: 3.3,  fixed: 0.30 },
      wise:   { pct: 0.45, fixed: 0.00 }
    },
    uk: {
      symbol: "£",
      stripe: { pct: 1.5,  fixed: 0.20 },
      paypal: { pct: 2.9,  fixed: 0.30 },
      square: { pct: 1.4,  fixed: 0.25 },
      wise:   { pct: 0.35, fixed: 0.00 }
    },
    ca: {
      symbol: "C$",
      stripe: { pct: 2.9,  fixed: 0.30 },
      paypal: { pct: 3.7,  fixed: 0.59 },
      square: { pct: 2.8,  fixed: 0.30 },
      wise:   { pct: 0.45, fixed: 0.00 }
    },
    au: {
      symbol: "A$",
      stripe: { pct: 1.75, fixed: 0.30 },
      paypal: { pct: 2.9,  fixed: 0.30 },
      square: { pct: 2.2,  fixed: 0.00 },
      wise:   { pct: 0.45, fixed: 0.00 }
    },
    eu: {
      symbol: "€",
      stripe: { pct: 1.5,  fixed: 0.25 },
      paypal: { pct: 2.9,  fixed: 0.35 },
      square: { pct: 1.4,  fixed: 0.25 },
      wise:   { pct: 0.41, fixed: 0.00 }
    },
    other: {
      symbol: "$",
      stripe: { pct: 2.9,  fixed: 0.30 },
      paypal: { pct: 3.49, fixed: 0.49 },
      square: { pct: 2.9,  fixed: 0.30 },
      wise:   { pct: 0.45, fixed: 0.00 }
    }
  };

  var PLATFORM_LABELS = { stripe: "Stripe", paypal: "PayPal", square: "Square", wise: "Wise", custom: "Custom" };

  // Cross-border surcharge is only offered for Stripe and PayPal.
  var CROSS_BORDER_ELIGIBLE = { stripe: true, paypal: true, square: false, wise: false, custom: false };
  var CROSS_BORDER_PCT = 1.5;

  var mode = "forward"; // "forward" | "reverse"

  // --- Defensive element lookup: never throws, just returns null if missing ---
  function $(id){ return document.getElementById(id); }

  var amountEl = $("amount");
  var amountLabel = $("amountLabel");
  var platformEl = $("platform");
  var countryEl = $("country");
  var customRow = $("customRow");
  var customPctEl = $("customPct");
  var customFixedEl = $("customFixed");
  var currencyPrefix = $("currencyPrefix");
  var customFixedPrefix = $("customFixedPrefix");
  var otherSymbolRow = $("otherSymbolRow");
  var otherSymbolEl = $("otherSymbol");
  var crossBorderHint = $("crossBorderHint");
  var crossBorderRow = $("crossBorderRow");
  var crossBorderCheck = $("crossBorderCheck");
  var reverseSymbolEl = $("reverseSymbol");

  var modeForwardBtn = $("modeForwardBtn");
  var modeReverseBtn = $("modeReverseBtn");

  var rBaseFee = $("rBaseFee");
  var rCrossRow = $("rCrossRow");
  var rCrossLabel = $("rCrossLabel");
  var rCross = $("rCross");
  var rNet = $("rNet");
  var rTotal = $("rTotal");
  var rNetLabel = $("rNetLabel");
  var rTotalLabel = $("rTotalLabel");
  var copyBtn = $("copyBtn");
  var yearEl = $("year");

  // Required elements the calculator cannot function without.
  // If any are missing (e.g. a stale/mismatched HTML file), stop here loudly
  // in the console instead of throwing mid-way and leaving the page half-wired.
  var required = {
    amount: amountEl, platform: platformEl, country: countryEl,
    modeForwardBtn: modeForwardBtn, modeReverseBtn: modeReverseBtn,
    rBaseFee: rBaseFee, rNet: rNet, rTotal: rTotal, copyBtn: copyBtn
  };
  var missing = [];
  for (var key in required) { if (!required[key]) missing.push(key); }
  if (missing.length) {
    console.error("Fee Calc: missing required element(s) — index.html and script.js are likely out of sync: " + missing.join(", "));
    return;
  }

  function setText(el, text){ if (el) el.textContent = text; }
  function toggleClass(el, cls, on){ if (el) el.classList.toggle(cls, on); }

  function currentSymbol(){
    if (countryEl.value === "other") {
      var typed = otherSymbolEl ? (otherSymbolEl.value || "").trim() : "";
      return typed || "$";
    }
    var rates = RATES[countryEl.value];
    return rates ? rates.symbol : "$";
  }

  function fmt(n){
    if (!isFinite(n)) n = 0;
    return currentSymbol() + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function currentRate(){
    var platformKey = platformEl.value;
    var countryRates = RATES[countryEl.value] || RATES.us;
    var base;

    if (platformKey === "custom") {
      base = {
        pct: customPctEl ? (parseFloat(customPctEl.value) || 0) : 0,
        fixed: customFixedEl ? (parseFloat(customFixedEl.value) || 0) : 0
      };
    } else {
      base = countryRates[platformKey] || { pct: 0, fixed: 0 };
    }

    var eligible = !!CROSS_BORDER_ELIGIBLE[platformKey];
    var crossChecked = !!(crossBorderCheck && crossBorderCheck.checked);
    var crossPct = (eligible && crossChecked) ? CROSS_BORDER_PCT : 0;

    return {
      basePct: base.pct,
      fixed: base.fixed,
      crossPct: crossPct
    };
  }

  var lastResult = { baseFee: 0, crossFee: 0, fee: 0, net: 0, total: 0, base: 0, platformLabel: "", crossApplied: false };

  function calculate(){
    var rate = currentRate();
    var totalPct = (rate.basePct + rate.crossPct) / 100;
    var fixed = rate.fixed;
    var input = parseFloat(amountEl.value);
    if (isNaN(input) || input < 0) input = 0;

    var fee, net, total, base;

    if (mode === "forward") {
      total = input;
      fee = total * totalPct + fixed;
      net = total - fee;
      base = total;
    } else {
      net = input;
      var denom = 1 - totalPct;
      total = denom > 0 ? (net + fixed) / denom : net + fixed;
      fee = total - net;
      base = net;
    }

    var baseFeePortion = total * (rate.basePct/100) + fixed;
    var crossFeePortion = total * (rate.crossPct/100);

    lastResult = {
      baseFee: baseFeePortion,
      crossFee: crossFeePortion,
      fee: fee,
      net: net,
      total: total,
      base: base,
      platformLabel: PLATFORM_LABELS[platformEl.value] || platformEl.value,
      crossApplied: rate.crossPct > 0
    };

    setText(rBaseFee, fmt(baseFeePortion));
    setText(rCross, fmt(crossFeePortion));
    toggleClass(rCrossRow, "visible", rate.crossPct > 0);
    setText(rCrossLabel, "Cross-border surcharge (+" + rate.crossPct.toFixed(1) + "%)");
    setText(rNet, fmt(net));
    setText(rTotal, fmt(total));
  }

  function updateHint(){
    if (!crossBorderHint) return;
    var platformKey = platformEl.value;
    var countryKey = countryEl.value;

    if (platformKey === "custom") {
      crossBorderHint.textContent = "Custom rate is used exactly as entered.";
    } else if (countryKey === "other") {
      crossBorderHint.textContent = "\"Other / International\" uses a generic global estimate for " + (PLATFORM_LABELS[platformKey] || platformKey) + " — for an exact figure, switch to \"Custom rate\" and enter your actual rate.";
    } else if (platformKey === "wise") {
      crossBorderHint.textContent = "Wise's mid-market rate is already designed for cross-border transfers — treat it as variable and approximate.";
    } else if (platformKey === "square") {
      crossBorderHint.textContent = "Default " + (PLATFORM_LABELS[platformKey] || platformKey) + " rate for " + countryKey.toUpperCase() + ". Square doesn't carry a separate cross-border surcharge in this tool.";
    } else {
      crossBorderHint.textContent = "Default " + (PLATFORM_LABELS[platformKey] || platformKey) + " rate for " + countryKey.toUpperCase() + ". Tick below if this is a cross-border payment.";
    }
  }

  function updateCrossBorderVisibility(){
    if (!crossBorderRow) return;
    var eligible = !!CROSS_BORDER_ELIGIBLE[platformEl.value];
    crossBorderRow.classList.toggle("visible", eligible);
    if (!eligible && crossBorderCheck) {
      crossBorderCheck.checked = false;
    }
  }

  function updateReverseLabel(){
    if (reverseSymbolEl) reverseSymbolEl.textContent = currentSymbol();
  }

  function setMode(newMode){
    mode = newMode;
    var isForward = mode === "forward";

    toggleClass(modeForwardBtn, "active", isForward);
    toggleClass(modeReverseBtn, "active", !isForward);
    modeForwardBtn.setAttribute("aria-selected", isForward ? "true" : "false");
    modeReverseBtn.setAttribute("aria-selected", !isForward ? "true" : "false");

    if (isForward) {
      setText(amountLabel, "Transaction amount");
      setText(rNetLabel, "Net amount you receive");
      setText(rTotalLabel, "Total to invoice client");
    } else {
      setText(amountLabel, "Amount you want to keep");
      setText(rNetLabel, "Net amount you keep");
      setText(rTotalLabel, "Total to invoice client");
    }
    calculate();
  }

  function togglePlatformFields(){
    toggleClass(customRow, "visible", platformEl.value === "custom");
    updateCrossBorderVisibility();
    updateHint();
    calculate();
  }

  function onCountryChange(){
    toggleClass(otherSymbolRow, "visible", countryEl.value === "other");
    var symbol = currentSymbol();
    setText(currencyPrefix, symbol);
    setText(customFixedPrefix, symbol);
    updateReverseLabel();
    updateHint();
    calculate();
  }

  modeForwardBtn.addEventListener("click", function(){ setMode("forward"); });
  modeReverseBtn.addEventListener("click", function(){ setMode("reverse"); });

  amountEl.addEventListener("input", calculate);
  platformEl.addEventListener("change", togglePlatformFields);
  countryEl.addEventListener("change", onCountryChange);
  if (otherSymbolEl) otherSymbolEl.addEventListener("input", onCountryChange);
  if (customPctEl) customPctEl.addEventListener("input", calculate);
  if (customFixedEl) customFixedEl.addEventListener("input", calculate);
  if (crossBorderCheck) crossBorderCheck.addEventListener("change", calculate);

  copyBtn.addEventListener("click", function(){
    var baseLabel = mode === "forward" ? "Invoice Base" : "Net Kept";
    var text = baseLabel + ": " + fmt(lastResult.base) +
      (lastResult.crossApplied ? " | Base Fee: " + fmt(lastResult.baseFee) + " | Cross-border: " + fmt(lastResult.crossFee) : " | Processing Fee: " + fmt(lastResult.fee)) +
      " | Total Payable: " + fmt(lastResult.total);

    function done(){
      var original = "Copy invoice note";
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(function(){
        copyBtn.textContent = original;
        copyBtn.classList.remove("copied");
      }, 1600);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  });

  function fallbackCopy(text, cb){
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch(e) {}
    document.body.removeChild(ta);
    if (cb) cb();
  }

  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // --- Modals (Privacy / Terms / About) ---
  var openOverlay = null;

  function openModal(id){
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    openOverlay = el;
  }

  function closeModal(el){
    if (!el) return;
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (openOverlay === el) openOverlay = null;
  }

  document.querySelectorAll("[data-modal]").forEach(function(trigger){
    trigger.addEventListener("click", function(){
      openModal(trigger.getAttribute("data-modal"));
    });
  });

  document.querySelectorAll(".modal-overlay").forEach(function(overlay){
    var closeBtn = overlay.querySelector(".modal-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function(){ closeModal(overlay); });
    }
    overlay.addEventListener("click", function(e){
      if (e.target === overlay) closeModal(overlay);
    });
  });

  document.addEventListener("keydown", function(e){
    if (e.key === "Escape" && openOverlay) closeModal(openOverlay);
  });

  // init — wrapped so a partial failure never leaves the whole tool inert
  try {
    togglePlatformFields();
    onCountryChange();
    setMode("forward");
  } catch (err) {
    console.error("Fee Calc: init error", err);
  }
})();
