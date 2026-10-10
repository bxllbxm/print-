/* LAYA 인쇄 점검 v1.0.0 — Adobe 앱 내 실행 도구
 * 문서 자동 수정 없음 / 네트워크 전송 없음
 * 기준: https://blog.naver.com/gilbutzigy/223785925614
 * SPDX-License-Identifier: MIT
 */
/* ES3: host-independent print rules. Unknown evidence never becomes a pass. */
function evaluatePreflight(s, job) {
    var MM = 72 / 25.4, i, j, a, ink, v, p, d, n;
    function valid(x, allowZero) { return typeof x === 'number' && isFinite(x) && (allowZero ? x >= 0 : x > 0); }
    if (!valid(job.safetyMm, true) || !valid(job.minPpi, false) ||
        (job.bleedMm !== null && !valid(job.bleedMm, true)) ||
        (job.smallTextPt !== null && !valid(job.smallTextPt, false))) throw Error('점검 기준에 올바른 숫자를 입력해 주세요.');
    var titles = ['재단 안전 여백', '도련과 배경 채움', '재단 주변 테두리', '작은 검정·회색 글자', '리치블랙', '글꼴과 윤곽선', '이미지 색상·해상도', '별색과 RGB'];
    var r = {version:'1.0.0',complete:false,host:s.host,documentName:s.documentName,job:job,rules:[],coverage:s.coverage || [],extra:s.extra || []};
    for (i=0;i<titles.length;i++) r.rules.push({number:i+1,title:titles[i],status:'확인 필요',details:[]});
    function add(index, status, msg) {
        var rule=r.rules[index];
        if (status==='주의' || rule.status!=='주의') rule.status=status;
        rule.details.push(msg);
    }
    function has(arr, x) { for(var k=0;k<arr.length;k++) if(arr[k]===x) return true; return false; }
    function cm(ink) { return ink && ink.space==='CMYK' && ink.values && ink.values.length===4; }
    function loc(a) { return a.label || '위치 미상'; }
    var items=s.items || [], texts=s.texts || [], images=s.images || [], pages=s.pages || [], fonts=s.fonts || [], spots=s.spots || [];
    add(0,'확인 필요','글자 프레임과 중요 객체 후보를 재단선 안쪽 '+job.safetyMm+'mm 기준으로 비교합니다. 글자·로고의 실제 외곽과 중요도는 직접 확인해 주세요.');
    for (i=0;i<items.length;i++) {
        a=items[i]; if (a.kind!=='text' || !a.boundsPt) continue;
        for(j=0;j<pages.length;j++) if(pages[j].label===a.pageLabel) {
            p=pages[j].boundsPt; d=a.boundsPt;
            if(!p || p.length!==4) {add(0,'확인 필요',pages[j].label+': 재단 좌표 미확인.');continue;}
            n=Math.min(d[0]-p[0],d[1]-p[1],p[2]-d[2],p[3]-d[3])/MM;
            if(isFinite(n) && n<job.safetyMm-0.01) add(0,'주의',loc(a)+': 안전 여백을 벗어난 프레임 후보, 최소 '+n.toFixed(2)+'mm. 실제 글자 외곽을 확인하세요.');
        }
    }
    add(1,'확인 필요',job.bleedMm===null?'인쇄소 도련 폭 미입력. 원문에는 도련 폭 숫자가 없습니다.':'인쇄소 도련 기준: '+job.bleedMm+'mm.');
    add(1,'확인 필요','문서 도련 설정만으로 배경이 작업선까지 채워졌음을 보장하지 않습니다. 배경·전면 그래픽을 확인하세요.');
    for(i=0;i<pages.length;i++) {
        p=pages[i];
        if(!p.bleedPt) {add(1,'확인 필요',p.label+': 도련 값을 읽을 수 없습니다.');continue;}
        a=[]; for(j=0;j<4;j++) a.push((p.bleedPt[j]/MM).toFixed(2));
        add(1,'확인 필요',p.label+': 도련 위/왼쪽/아래/오른쪽 '+a.join('/')+'mm.');
        if(job.bleedMm!==null) for(j=0;j<4;j++) if(p.bleedPt[j]/MM<job.bleedMm-0.01) {add(1,'주의',p.label+': 설정된 도련이 인쇄소 기준보다 작습니다.');break;}
    }
    add(2,'확인 필요','재단 주변 테두리에만 3mm 권고를 적용합니다. 장식선·내부 선은 이 기준으로 판정하지 않습니다.');
    for(i=0;i<items.length;i++) if(items[i].borderCandidate) {
        a=items[i];
        if(valid(a.strokePt,false)) {
            n=a.strokePt/MM;
            add(2,n<3-0.01?'주의':'확인 필요',loc(a)+': 외곽 테두리 후보 '+n.toFixed(2)+'mm. 실제 테두리 여부와 최종 출력 두께를 확인하세요.');
        } else add(2,'확인 필요',loc(a)+': 외곽 테두리 후보의 최종 획 두께 미확인.');
    }
    add(3,'확인 필요',job.smallTextPt===null?'작은 글자 pt 기준 미입력. 원문에 pt 경계가 없으므로 임의로 정하지 않습니다.':'작은 글자 기준: '+job.smallTextPt+'pt 이하 (사용자 지정).');
    add(3,'확인 필요','검정 의도인 작은 글자는 K100, 회색은 K 단색인지 확인하세요. 색의 용도·얇은 획·최종 분판은 직접 확인합니다.');
    add(4,'확인 필요','잉크 건조·뒷묻음·페이지 간 색상 차이는 인쇄소와 확인하세요. C30/K100은 원문 예시이며 권장 배합이 아닙니다.');
    for(i=0;i<texts.length;i++) {
        a=texts[i]; var inks=[a.ink,a.strokeInk];
        for(j=0;j<inks.length;j++) {
            ink=inks[j]; if(!ink || ink.space==='None') continue;
            if(cm(ink)) {
                v=ink.values;
                if(v[0]===0 && v[1]===0 && v[2]===0 && v[3]>0 && v[3]<=10)
                    add(3,'주의',loc(a)+': K'+v[3]+'의 옅은 글자 후보. 작은·얇은 글자는 선명도 확인.');
                if(v[3]>0 && (v[0]>0 || v[1]>0 || v[2]>0)) {
                    add(3,job.smallTextPt!==null && valid(a.sizePt,false) && a.sizePt<=job.smallTextPt?'주의':'확인 필요',loc(a)+': C/M/Y/K '+v.join('/')+' 혼합 잉크 글자. 검정·회색 의도인지 확인.');
                    if(v[3]>=99.9) add(4,'주의',loc(a)+': 리치블랙 후보 C/M/Y/K '+v.join('/')+'. 작은 글자의 핀 어긋남을 확인하세요.');
                }
            } else if(ink.space!=='RGB') add(3,'확인 필요',loc(a)+': '+ink.space+' 글자 색을 K 분판으로 확인하세요.');
            if(ink.space==='RGB') add(7,'주의',loc(a)+': RGB 글자 색 검출. 인쇄소 출력 변환과 최종 색을 확인하세요.');
            if(ink.space==='Spot') {
                n=has(job.allowedSpots || [],ink.name);
                add(7,n?'확인 필요':'주의',loc(a)+': 별색 '+ink.name+(n?' (지정된 별색).':' 사용. 의도·후가공 용도를 확인하세요.'));
            }
        }
    }
    add(5,'확인 필요',job.delivery==='pdf'?'최종 PDF의 글꼴 포함과 렌더링을 확인하세요. 모든 PDF 글자를 일괄 윤곽선으로 만들 필요는 없습니다.':'PDF 외 원본 납품: 인쇄소의 글꼴·윤곽선 요구를 확인하세요.');
    if(job.delivery==='singleOriginal' && texts.length>0) add(5,'주의','PDF 외 낱장 표지·명함 납품: 편집 가능한 글자가 있습니다. 원문 윤곽선 권고를 확인하세요.');
    for(i=0;i<fonts.length;i++) {
        a=fonts[i];
        if(a.status==='missing') add(5,'주의','누락·대체 가능 글꼴: '+a.name+'.');
        if(a.embedAllowed===false) add(5,'주의','PDF 포함 제한 글꼴: '+a.name+'.');
        if(a.status==='unknown') add(5,'확인 필요','사용 글꼴 '+a.name+': 설치·대체 상태 미확인.');
    }
    if(images.length===0) add(6,'확인 필요','자동 수집된 래스터 이미지 없음. 포함된 PDF·EPS·심볼 등 내부 이미지는 별도로 확인하세요.');
    else {
        r.rules[6].status='확인됨';
        add(6,'확인됨','수집된 이미지 '+images.length+'건을 유효 PPI '+job.minPpi+'·CMYK 기준으로 비교합니다. 내보낸 PDF의 재표본화와 미지원 객체는 별도 확인.');
        var unknownImage=false;
        for(i=0;i<images.length;i++) {
            a=images[i]; var status='확인됨';
            if(!a.ppi || a.ppi.length<2 || !valid(a.ppi[0],false) || !valid(a.ppi[1],false)) {status='확인 필요';unknownImage=true;}
            else if(Math.min(a.ppi[0],a.ppi[1])<job.minPpi) status='주의';
            if(a.space==='RGB') status='주의';
            else if(a.space!=='CMYK') {unknownImage=true;if(status!=='주의') status='확인 필요';}
            add(6,status,loc(a)+': '+a.space+', 유효 PPI '+(a.ppi?a.ppi.join(' × '):'미확인')+'.');
        }
        if(unknownImage && r.rules[6].status!=='주의') r.rules[6].status='확인 필요';
        if(s.imageCoverageComplete===false) add(6,'확인 필요','이미지 또는 포함 그래픽 중 자동 검사하지 못한 범위가 있습니다. 전체 이미지 조건을 확인해 주세요.');
    }
    add(7,'확인 필요','사용 별색의 의도, 포함 그래픽 내부, 출력 색상 변환·분판을 확인하세요. 미사용 견본은 실제 사용의 증거가 아닙니다.');
    for(i=0;i<spots.length;i++) {
        a=spots[i]; n=has(job.allowedSpots || [],a.name);
        add(7,a.used===true && !n?'주의':'확인 필요',a.name+': '+(a.used===true?'사용 검출':a.used===false?'미사용 견본':'견본 있음, 사용 여부 미확인')+(n?' / 지정 별색':' / 의도 확인')+'.');
    }
    return r;
}
function preflightReportText(r) {
    var lines=['LAYA 인쇄 점검 v'+r.version,r.host+' — '+r.documentName,'원본의 부분 점검 결과 / 최종 인쇄 파일 인증 아님','',
        '기준: 안전 여백 '+r.job.safetyMm+'mm, 최소 '+r.job.minPpi+'PPI, 도련 '+(r.job.bleedMm===null?'미입력':r.job.bleedMm+'mm')+', 작은 글자 '+(r.job.smallTextPt===null?'미입력':r.job.smallTextPt+'pt'),
        '납품 방식: '+r.job.delivery,'지정 별색: '+((r.job.allowedSpots || []).join(', ') || '미입력'),''];
    var i,j,a;
    for(i=0;i<r.rules.length;i++) {a=r.rules[i];lines.push(a.number+'. '+a.title+' — '+a.status);for(j=0;j<a.details.length;j++) lines.push('  '+a.details[j]);lines.push('');}
    lines.push('추가 점검');
    for(i=0;i<r.extra.length;i++) lines.push('['+r.extra[i].severity+'] '+r.extra[i].message);
    for(i=0;i<r.coverage.length;i++) lines.push('[확인 필요] '+r.coverage[i]);
    lines.push('최종 PDF의 도련 채움, 글꼴 포함, 분판, 인쇄소 사양을 별도로 확인하세요.', '',
        '기준 출처: 길벗 「인쇄할 때 꼭 알아야 하는 주의사항 8가지!!」',
        'https://blog.naver.com/gilbutzigy/223785925614');
    return lines.join('\n');
}

/* InDesign read-only evidence collector. ES3 / ExtendScript compatible.
 * Adobe DOM references (properties shared by the ExtendScript DOM):
 * https://developer.adobe.com/indesign/uxp/dom/api/i/image/
 * https://developer.adobe.com/indesign/uxp/dom/api/c/color/
 * https://developer.adobe.com/indesign/uxp/dom/api/t/tint/
 * https://developer.adobe.com/indesign/uxp/dom/api/f/font/
 * https://developer.adobe.com/indesign/uxp/dom/api/s/script-preference/
 * No document property, selection, link, font, or text is modified.
 */
function collectInDesign(doc) {
    var out = { host: "InDesign", documentName: "", pages: [], items: [], texts: [], images: [], imageCoverageComplete: true, spots: [], fonts: [], extra: [], coverage: [] };
    var caps = { pages: 2000, items: 20000, graphics: 10000, stories: 5000, ranges: 50000, swatches: 5000, fonts: 5000, links: 10000 };
    var noteKeys = {}, coverageKeys = {}, spotKeys = {}, swatchNames = {}, pageLabelKeys = {}, pageEntries = [];
    var omittedNotes = 0, totalRanges = 0, unitsReady = false, oldUnit, prefs = null, restoreUnit = false;
    var colorSpaces = typeof ColorSpace !== "undefined" ? ColorSpace : null;
    var colorModels = typeof ColorModel !== "undefined" ? ColorModel : null;
    var fontStatuses = typeof FontStatus !== "undefined" ? FontStatus : null;
    var linkStatuses = typeof LinkStatus !== "undefined" ? LinkStatus : null;
    var pageSides = typeof PageSideOptions !== "undefined" ? PageSideOptions : null;
    var nothing = typeof NothingEnum !== "undefined" ? NothingEnum : null;

    function note(severity, message, key) {
        key = "$" + (key || message);
        if (noteKeys[key]) { return; }
        noteKeys[key] = true;
        if (out.extra.length < 150) { out.extra.push({ severity: severity, message: message }); }
        else { omittedNotes++; }
    }
    function cover(message) {
        var key = "$" + message;
        if (!coverageKeys[key]) { coverageKeys[key] = true; out.coverage.push(message); }
    }
    function failed(label, key) {
        note("확인 필요", label + ": 속성 또는 객체를 읽지 못했습니다. 해당 범위를 원본에서 확인하세요.", "read:" + (key || label));
        cover(label + ": 읽지 못한 범위는 검사 완료에 포함하지 않습니다.");
    }
    function get(obj, prop, label, required) {
        var value;
        try {
            if (obj === null || typeof obj === "undefined") { throw new Error("No object"); }
            value = obj[prop];
            if (typeof value === "undefined" && required) { failed(label || prop); }
            return value;
        } catch (e) { if (required) { failed(label || prop); } return undefined; }
    }
    function number(value) {
        if (typeof value === "number" && isFinite(value)) { return value; }
        if (typeof value === "string" && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(value)) {
            var parsed = Number(value); return isFinite(parsed) ? parsed : null;
        }
        return null;
    }
    function point(value) {
        if (!unitsReady) { return null; }
        var n = number(value), match, multiplier;
        if (n !== null) { return n; }
        if (typeof value === "string") {
            match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(pt|mm|cm|in|pc)\s*$/i.exec(value);
            if (match) {
                multiplier = { pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, "in": 72, pc: 12 }[match[2].toLowerCase()];
                return Number(match[1]) * multiplier;
            }
        }
        return null;
    }
    function string(value) { try { return String(value); } catch (e) { return ""; } }
    function typeOf(obj) {
        var reflected = get(obj, "reflect", "", false), name = reflected ? get(reflected, "name", "", false) : undefined;
        if (name) { return string(name); }
        var constructor = get(obj, "constructor", "", false);
        return constructor ? string(get(constructor, "name", "", false) || "") : "";
    }
    function enumIs(value, group, name) {
        if (group) {
            try { if (typeof group[name] !== "undefined" && value === group[name]) { return true; } } catch (e) {}
        }
        var normalized = string(value).toUpperCase();
        return normalized === name || normalized === name.replace(/_/g, " ") || normalized.slice(-(name.length + 1)) === "." + name;
    }
    function label(obj, fallback) {
        var name = get(obj, "name", "", false), custom = get(obj, "label", "", false), id;
        if (name && string(name)) { return string(name); }
        if (custom && string(custom)) { return string(custom); }
        id = get(obj, "id", "", false);
        return fallback + (typeof id !== "undefined" ? " #" + string(id) : "");
    }
    function lengthOf(collection, context) {
        var len = number(get(collection, "length", context, true));
        if (len === null || len < 0 || Math.floor(len) !== len) { failed(context); return null; }
        return len;
    }
    function at(collection, index, context) {
        var item;
        try {
            item = collection[index];
            if (typeof item === "undefined" && typeof collection.item === "function") { item = collection.item(index); }
            if (typeof item === "undefined" || item === null || get(item, "isValid", "", false) === false) { throw new Error("Invalid item"); }
            return item;
        } catch (e) { failed(context + " #" + (index + 1)); return null; }
    }
    function scan(collection, context, limit, fn, imageScan) {
        if (typeof collection === "undefined" || collection === null) { if (imageScan) { out.imageCoverageComplete = false; } failed(context); return; }
        var len = lengthOf(collection, context), count, i, item;
        if (len === null) { if (imageScan) { out.imageCoverageComplete = false; } return; }
        count = Math.min(len, limit);
        if (len > limit) {
            if (imageScan) { out.imageCoverageComplete = false; }
            note("확인 필요", context + ": 검사량 제한으로 " + count + "/" + len + "개만 읽었습니다. 나머지는 수동 확인하세요.", "cap:" + context);
            cover(context + ": 검사량 제한 이후의 나머지 객체는 미검사입니다.");
        }
        for (i = 0; i < count; i++) {
            item = at(collection, i, context);
            if (item) { try { fn(item, i); } catch (e) { if (imageScan) { out.imageCoverageComplete = false; } failed(context + " #" + (i + 1)); } }
            else if (imageScan) { out.imageCoverageComplete = false; }
        }
    }
    function bounds(obj, prop, context) {
        if (!unitsReady) { return null; }
        var value = get(obj, prop, context, true), result = [], i, n;
        if (!value || get(value, "length", "", false) !== 4) { failed(context); return null; }
        for (i = 0; i < 4; i++) {
            n = point(get(value, i, context, true));
            if (n === null) { failed(context); return null; }
            result.push(n);
        }
        if (result[2] < result[0] || result[3] < result[1]) { failed(context); return null; }
        return result;
    }
    function unknownInk(name, context) {
        failed(context || "색상 값"); return { space: "Unknown", values: [], name: name || "" };
    }
    function isNone(swatch) {
        if (enumIs(swatch, nothing, "NOTHING")) { return true; }
        var name = typeof swatch === "string" ? swatch : get(swatch, "name", "", false);
        if (!name) { return false; }
        name = string(name).replace(/^\$ID\//, "").replace(/^\[|\]$/g, "").toLowerCase();
        return name === "none" || name === "없음" || name === "なし" || name === "ohne" || name === "sans" || name === "ninguno" || name === "nessuno" || name === "nenhum";
    }
    function addSpot(name) {
        name = name || "이름 없는 별색";
        if (!spotKeys["$" + name]) { spotKeys["$" + name] = true; out.spots.push({ name: name, used: null }); }
    }
    function inventorySpot(swatch, depth) {
        var base = get(swatch, "baseColor", "", false), type = typeOf(swatch);
        if (depth > 10) { failed("별색 틴트 기본색 연결"); return; }
        if (type === "Tint" || typeof base !== "undefined") {
            if (base) { inventorySpot(base, depth + 1); }
            else { failed("별색 틴트 기본색"); }
            return;
        }
        if (enumIs(get(swatch, "model", "", false), colorModels, "SPOT")) { addSpot(label(swatch, "이름 없는 별색")); }
    }
    function spaceOf(value) {
        if (enumIs(value, colorSpaces, "CMYK") || /^cmyk$/i.test(string(value))) { return "CMYK"; }
        if (enumIs(value, colorSpaces, "RGB") || /^(?:s?rgb)$/i.test(string(value))) { return "RGB"; }
        if (enumIs(value, colorSpaces, "GRAY") || /^(?:gray|grey|grayscale|greyscale)$/i.test(string(value))) { return "Gray"; }
        return "Unknown";
    }
    function ink(swatch, fraction, context, depth, originalName) {
        var name, model, type, base, tint, space, values, expected, i, n, result = [];
        if (isNone(swatch)) { return { space: "None", values: [], name: typeof swatch === "string" ? swatch : string(get(swatch, "name", "", false) || "None") }; }
        if (!swatch || depth > 10) { return unknownInk(originalName, context + " (색상 또는 틴트 연결)"); }
        if (typeof swatch === "string") {
            if (swatchNames["$" + swatch]) { return ink(swatchNames["$" + swatch], fraction, context, depth + 1, originalName || swatch); }
            return unknownInk(swatch, context + " (스와치 이름만 제공됨)");
        }
        name = string(get(swatch, "name", "", false) || "");
        originalName = originalName || name;
        model = get(swatch, "model", "", false);
        if (enumIs(model, colorModels, "REGISTRATION") || /^\[?(?:registration|레지스트레이션|정합|レジストレーション)\]?$/i.test(name)) {
            note("주의", context + ": 레지스트레이션(Registration) 잉크는 모든 분판에 출력될 수 있습니다. 일반 CMYK 글자색으로 판정하지 않습니다.", "registration:" + context);
            return { space: "Unknown", values: [], name: originalName };
        }
        type = typeOf(swatch);
        base = get(swatch, "baseColor", "", false);
        if (type === "Tint" || typeof base !== "undefined") {
            if (!base) { return unknownInk(originalName, context + " 틴트 기본색"); }
            tint = number(get(swatch, "tintValue", context + " 틴트 농도", true));
            if (tint === null || tint < 0 || tint > 100) { return unknownInk(originalName, context + " 틴트 농도"); }
            return ink(base, fraction * tint / 100, context, depth + 1, originalName);
        }
        if (enumIs(model, colorModels, "SPOT")) {
            addSpot(name); return { space: "Spot", values: [100 * fraction], name: name };
        }
        space = spaceOf(get(swatch, "space", context + " 색 공간", true));
        if (space === "Unknown" || (type && type !== "Color" && type !== "Object")) {
            cover("그라데이션·혼합 잉크·LAB 또는 미지원 색상은 원본과 최종 분판에서 추가 확인해야 합니다.");
            return unknownInk(originalName, context + " (지원되지 않는 색 공간)");
        }
        values = get(swatch, "colorValue", context + " 잉크 값", true);
        expected = space === "CMYK" ? 4 : (space === "RGB" ? 3 : 1);
        if (!values || get(values, "length", "", false) !== expected) { return unknownInk(originalName, context + " 잉크 값"); }
        for (i = 0; i < expected; i++) {
            n = number(get(values, i, "", false));
            if (n === null || n < 0 || n > (space === "RGB" ? 255 : 100)) { return unknownInk(originalName, context + " 잉크 값"); }
            result.push(space === "RGB" ? 255 - ((255 - n) * fraction) : n * fraction);
        }
        return { space: space, values: result, name: originalName };
    }
    function paint(obj, which, context) {
        var swatch = get(obj, which + "Color", context + " " + which + " 색상", true), tint;
        if (isNone(swatch)) { return ink(swatch, 1, context, 0, ""); }
        tint = number(get(obj, which + "Tint", context + " " + which + " 틴트 농도", true));
        if (tint === null || tint < 0 || tint > 100) { return unknownInk("", context + " " + which + " 틴트 농도 (상속값 포함)"); }
        return ink(swatch, tint / 100, context + " " + which, 0, "");
    }
    function pageFor(item) {
        var p = get(item, "parentPage", "", false), id, i;
        if (!p) { return null; }
        id = get(p, "id", "", false);
        for (i = 0; i < pageEntries.length; i++) {
            if (p === pageEntries[i].object || (typeof id !== "undefined" && id === pageEntries[i].id)) { return pageEntries[i].data; }
        }
        return null;
    }
    function transformed(item, context) {
        var h = number(get(item, "absoluteHorizontalScale", "", false));
        var v = number(get(item, "absoluteVerticalScale", "", false));
        var rotation = number(get(item, "absoluteRotationAngle", "", false));
        var shear = number(get(item, "absoluteShearAngle", "", false));
        if (h === null || v === null || rotation === null || shear === null || Math.abs(h - 100) > 0.001 || Math.abs(v - 100) > 0.001 || Math.abs(rotation % 180) > 0.001 || Math.abs(shear) > 0.001) {
            note("확인 필요", context + ": 확대·축소 또는 회전·기울임 변환의 최종 획 두께와 테두리 위치를 수동 확인하세요.", "transform:" + context);
            cover("확대·축소 또는 변환이 있거나 변환 API를 읽지 못한 테두리의 최종 획 두께는 자동 판정하지 않습니다.");
            return true;
        }
        return false;
    }
    function readPages() {
        var dp = get(doc, "documentPreferences", "문서 도련 설정", true), bleed = null, facing, t, b, inside, outside;
        if (unitsReady && dp) {
            t = point(get(dp, "documentBleedTopOffset", "위 도련", true));
            b = point(get(dp, "documentBleedBottomOffset", "아래 도련", true));
            inside = point(get(dp, "documentBleedInsideOrLeftOffset", "안쪽/왼쪽 도련", true));
            outside = point(get(dp, "documentBleedOutsideOrRightOffset", "바깥쪽/오른쪽 도련", true));
            if (t !== null && b !== null && inside !== null && outside !== null && Math.min(t, b, inside, outside) >= 0) { bleed = [t, inside, b, outside]; }
            else { failed("문서 도련 값"); }
        }
        facing = get(dp, "facingPages", "페이지 마주보기 설정", true);
        scan(get(doc, "pages", "문서 페이지", true), "문서 페이지", caps.pages, function (p, index) {
            var data = { label: label(p, "페이지 " + (index + 1)), boundsPt: bounds(p, "bounds", "페이지 " + (index + 1) + " 경계"), bleedPt: bleed ? bleed.slice(0) : null };
            var originalLabel = data.label, suffix = 0;
            while (pageLabelKeys["$" + data.label]) {
                data.label = originalLabel + " (문서 페이지 " + (index + 1) + (suffix ? ", " + suffix : "") + ")";
                suffix++;
            }
            pageLabelKeys["$" + data.label] = true;
            var side = get(p, "side", "", false);
            if (bleed && facing === true) {
                if (enumIs(side, pageSides, "LEFT_HAND")) { data.bleedPt = [bleed[0], bleed[3], bleed[2], bleed[1]]; }
                else if (!enumIs(side, pageSides, "RIGHT_HAND") && !enumIs(side, pageSides, "SINGLE_SIDED")) { data.bleedPt = null; failed(data.label + " 안쪽/바깥쪽 도련 매핑"); }
            } else if (bleed && typeof facing !== "boolean") { data.bleedPt = null; failed(data.label + " 도련 매핑"); }
            out.pages.push(data); pageEntries.push({ object: p, id: get(p, "id", "", false), data: data });
        });
    }
    function readItems() {
        scan(get(doc, "allPageItems", "페이지 객체 allPageItems", true), "페이지 객체 allPageItems", caps.items, function (item, index) {
            var type = typeOf(item), name = label(item, "객체 " + (index + 1)), page = pageFor(item), kind = "other", supportedPaint = false;
            var geometry = bounds(item, "geometricBounds", name + " 경계"), weight = null, stroke = null, fill, candidate = false, i, near = true;
            if (/^(TextFrame|EndnoteTextFrame|TextPath)$/.test(type)) { kind = "text"; supportedPaint = type !== "TextPath"; }
            else if (/^(Rectangle|Oval|Polygon|GraphicLine)$/.test(type)) { kind = "shape"; supportedPaint = true; }
            else if (/^(Image|PDF|EPS|SVG|ImportedPage|PICT|WMF)$/.test(type)) { kind = "image"; supportedPaint = true; }
            if (kind === "shape") {
                var graphics = get(item, "graphics", "", false);
                if (graphics && number(get(graphics, "length", "", false)) > 0) { kind = "image"; }
            }
            if (!page) {
                cover("페이지에 연결되지 않은 객체, 붙여넣기판 객체 및 마스터 페이지 객체의 재단 위치는 수동 확인해야 합니다.");
                note("확인 필요", name + ": 문서 페이지에 연결된 위치를 확인하지 못했습니다.", "page:" + name);
            }
            if (supportedPaint) {
                fill = paint(item, "fill", name);
                if (fill.space === "RGB") { note("주의", name + ": 객체 채움에 RGB 색상이 있습니다. 최종 출력 변환과 분판을 확인하세요.", "rgbfill:" + name); }
                if (fill.space === "Spot") { note("확인 필요", name + ": 객체 채움에 별색 " + fill.name + " 사용을 읽었습니다. 의도·후가공 용도와 인쇄소 사양을 확인하세요.", "spotfill:" + name); }
                stroke = paint(item, "stroke", name);
                weight = point(get(item, "strokeWeight", name + " 획 두께", true));
                if (weight === null || weight < 0) { weight = null; failed(name + " 획 두께"); }
                if (weight > 0 && stroke.space === "RGB") { note("주의", name + ": 객체 획에 RGB 색상이 있습니다. 최종 출력 변환과 분판을 확인하세요.", "rgbstroke:" + name); }
                if (weight > 0 && stroke.space === "Spot") { note("확인 필요", name + ": 객체 획에 별색 " + stroke.name + " 사용을 읽었습니다. 의도·후가공 용도와 인쇄소 사양을 확인하세요.", "spotstroke:" + name); }
                if (stroke.space === "None") { weight = 0; }
            } else {
                cover("그룹·지원되지 않는 객체의 실제 출력 외곽, 효과, 채움과 획은 원본에서 확인해야 합니다.");
            }
            if (type === "Rectangle" && weight > 0 && stroke && stroke.space !== "None" && stroke.space !== "Unknown" && page && page.boundsPt && geometry) {
                for (i = 0; i < 4; i++) { if (Math.abs(geometry[i] - page.boundsPt[i]) > 5 * 72 / 25.4) { near = false; } }
                if (near) { if (transformed(item, name)) { weight = null; } else { candidate = true; } }
            }
            out.items.push({ label: name, pageLabel: page ? page.label : "", boundsPt: geometry, kind: kind, strokePt: weight, borderCandidate: candidate });
            if (kind === "text") {
                var overflows = get(item, "overflows", name + " 넘친 텍스트", type !== "TextPath");
                if (overflows === true) { note("주의", name + ": 프레임에 넘친 텍스트가 있습니다.", "oversetframe:" + name); }
            }
        });
    }
    function readTexts() {
        scan(get(doc, "stories", "스토리", true), "스토리", caps.stories, function (story, storyIndex) {
            var name = label(story, "스토리 " + (storyIndex + 1)), overflows = get(story, "overflows", name + " 넘친 텍스트", true);
            if (overflows === true) { note("주의", name + ": 스토리에 넘친 텍스트가 있습니다.", "oversetstory:" + name); }
            var remaining = Math.max(0, caps.ranges - totalRanges);
            scan(get(story, "textStyleRanges", name + " 텍스트 범위", true), "텍스트 범위 " + name, remaining, function (range, index) {
                totalRanges++;
                var textLabel = name + " / 텍스트 범위 " + (index + 1), size = point(get(range, "pointSize", textLabel + " 글자 크기", true));
                var fillInk = paint(range, "fill", textLabel), strokeWeight = point(get(range, "strokeWeight", textLabel + " 글자 획 두께", true));
                var strokeInk = strokeWeight === 0 ? { space: "None", values: [], name: "None" } : paint(range, "stroke", textLabel);
                if (size === null || size <= 0) { size = null; failed(textLabel + " 글자 크기"); }
                if (strokeWeight === null || strokeWeight < 0) { failed(textLabel + " 글자 획 두께"); }
                out.texts.push({ label: textLabel, sizePt: size, ink: fillInk, strokeInk: strokeInk });
            });
        });
    }
    function readGraphics() {
        scan(get(doc, "allGraphics", "배치 그래픽 allGraphics", true), "배치 그래픽 allGraphics", caps.graphics, function (graphic, index) {
            var name = label(graphic, "그래픽 " + (index + 1)), type = typeOf(graphic), ppi = null, space = "Unknown", raw, x, y;
            if (type === "Image") {
                raw = get(graphic, "effectivePpi", name + " 유효 PPI", true);
                if (raw && get(raw, "length", "", false) === 2) {
                    x = number(get(raw, 0, "", false)); y = number(get(raw, 1, "", false));
                    if (x !== null && y !== null && x > 0 && y > 0) { ppi = [x, y]; }
                } else {
                    x = number(raw); if (x !== null && x > 0) { ppi = [x, x]; }
                }
                if (!ppi) { out.imageCoverageComplete = false; failed(name + " 유효 PPI"); }
                space = spaceOf(get(graphic, "space", name + " 이미지 색 공간", true));
                if (space === "Unknown") { out.imageCoverageComplete = false; failed(name + " 이미지 색 공간"); }
            } else {
                out.imageCoverageComplete = false;
                note("확인 필요", name + ": " + (type || "미지원 그래픽") + " 내부 이미지의 해상도·색상은 이 수집기로 확인하지 못합니다.", "graphic:" + name);
                cover("PDF·EPS·SVG 및 미지원 배치 그래픽 내부의 글자·벡터·이미지 색상과 해상도는 별도로 확인해야 합니다.");
            }
            out.images.push({ label: name, ppi: ppi, space: space });
        }, true);
    }
    function readFonts() {
        scan(get(doc, "fonts", "문서 폰트", true), "문서 폰트", caps.fonts, function (font, index) {
            var name = label(font, "폰트 " + (index + 1)), raw = get(font, "status", name + " 폰트 상태", true), status = "unknown";
            var embed = get(font, "allowPDFEmbedding", name + " PDF 폰트 포함 허용", true);
            if (enumIs(raw, fontStatuses, "INSTALLED")) { status = "installed"; }
            else if (enumIs(raw, fontStatuses, "NOT_AVAILABLE") || enumIs(raw, fontStatuses, "SUBSTITUTED") || enumIs(raw, fontStatuses, "FAUXED")) { status = "missing"; }
            if (status === "missing") { note("주의", name + ": 폰트가 누락되었거나 대체·합성되었습니다.", "font:" + name); }
            if (status === "unknown") { failed(name + " 폰트 상태"); }
            if (typeof embed !== "boolean") { embed = null; failed(name + " PDF 폰트 포함 허용"); }
            out.fonts.push({ name: name, status: status, embedAllowed: embed });
        });
    }
    function readLinks() {
        scan(get(doc, "links", "문서 링크", true), "문서 링크", caps.links, function (link, index) {
            var name = label(link, "링크 " + (index + 1)), status = get(link, "status", name + " 링크 상태", true);
            if (enumIs(status, linkStatuses, "LINK_MISSING")) { note("주의", name + ": 링크 파일이 누락되었습니다.", "link:" + name); }
            else if (enumIs(status, linkStatuses, "LINK_OUT_OF_DATE")) { note("주의", name + ": 링크 파일이 변경되어 문서의 배치 내용이 최신 상태인지 확인해야 합니다.", "link:" + name); }
            else if (enumIs(status, linkStatuses, "LINK_INACCESSIBLE")) { note("주의", name + ": 링크 파일에 접근할 수 없습니다.", "link:" + name); }
            else if (!enumIs(status, linkStatuses, "NORMAL") && !enumIs(status, linkStatuses, "LINK_EMBEDDED")) { failed(name + " 링크 상태"); }
        });
    }

    cover("글자 안전 여백은 텍스트 프레임 경계의 후보 거리입니다. 글자 윤곽·실제 글리프와 중요도를 수동 확인해야 합니다.");
    cover("로고·아웃라인 글자·이미지 안의 글자, 숨김/비인쇄 객체, 마스크·효과 및 배경이 도련 끝까지 채워졌는지는 수동 확인해야 합니다.");
    cover("배치 비트맵은 Image.effectivePpi와 Image.space를 읽습니다. 최종 PDF 변환·재표본화·분판 결과는 별도 확인해야 합니다.");
    cover("별색 스와치 목록은 미사용 스와치를 포함할 수 있으며 사용 여부와 별색 의도를 확정하지 않습니다.");
    cover("스토리의 기본 텍스트 스타일 범위를 읽습니다. 표·각주·후주·문단 음영/테두리·장식선·조건부/숨김 텍스트 및 마스터의 실제 출력은 별도 확인해야 합니다.");
    cover("Font.allowPDFEmbedding은 포함 허용 여부입니다. 실제 최종 PDF의 폰트 포함 상태는 별도 확인해야 합니다.");
    try {
        if (!doc || get(doc, "isValid", "", false) === false) { out.imageCoverageComplete = false; failed("활성 InDesign 문서"); return out; }
        out.documentName = label(doc, "이름 없는 InDesign 문서");
        try {
            prefs = app.scriptPreferences;
            oldUnit = prefs.measurementUnit;
            if (typeof oldUnit === "undefined") { throw new Error("Unknown original measurement unit"); }
            restoreUnit = true;
            prefs.measurementUnit = MeasurementUnits.POINTS;
            unitsReady = prefs.measurementUnit === MeasurementUnits.POINTS;
            if (!unitsReady) { throw new Error("Point unit was not applied"); }
        } catch (e) { note("확인 필요", "스크립트 측정 단위를 pt로 확인하지 못했습니다. 경계·도련·글자 크기·획 두께는 자동 판정하지 않습니다.", "units"); }
        readPages();
        scan(get(doc, "swatches", "문서 스와치", true), "문서 스와치", caps.swatches, function (swatch, index) {
            var name = label(swatch, "스와치 " + (index + 1));
            swatchNames["$" + name] = swatch;
            inventorySpot(swatch, 0);
        });
        var masters = get(doc, "masterSpreads", "마스터 페이지 범위", true);
        var masterCount = masters ? lengthOf(masters, "마스터 페이지 범위") : null;
        if (masterCount === null) { out.imageCoverageComplete = false; }
        if (masterCount > 0) {
            out.imageCoverageComplete = false;
            cover("마스터 페이지 객체의 실제 적용·출력 위치와 마스터 텍스트/이미지는 자동 검사 범위 밖이며 문서 페이지별로 수동 확인해야 합니다.");
            note("확인 필요", "마스터 페이지가 있습니다. 상속 객체의 실제 적용·출력과 위치는 문서 페이지별로 수동 확인하세요.", "masters");
        }
        readItems(); readTexts(); readGraphics(); readFonts(); readLinks();
    } catch (e) { out.imageCoverageComplete = false; failed("InDesign 수집 중단"); }
    finally {
        if (restoreUnit && prefs) {
            try { prefs.measurementUnit = oldUnit; }
            catch (e) { note("확인 필요", "원래 스크립트 측정 단위를 복원하지 못했습니다. 앱의 스크립트 환경 설정을 확인하세요.", "restore"); }
        }
        if (omittedNotes > 0) { out.extra.push({ severity: "확인 필요", message: "보고서 표시량 제한으로 추가 경고 " + omittedNotes + "개를 생략했습니다. 원본의 전체 Preflight 결과를 확인하세요." }); cover("경고 표시량 제한 이후의 세부 결과는 이 보고서에 포함되지 않습니다."); }
    }
    return out;
}

/* Read-only Illustrator collector. ES3 syntax for ExtendScript. */
function collectIllustrator(doc) {
    var out = { host: "Illustrator", documentName: "", pages: [], items: [], texts: [], images: [], spots: [], fonts: [], extra: [], coverage: [], imageCoverageComplete: false };
    var visited = [], noticeKeys = {}, fontNames = {}, spotNames = {}, pageLabels = {};
    var scannedCharacters = 0, characterLimit = 30000, capped = false;
    var edgeTolerancePt = 5 * 72 / 25.4;

    function get(object, property) {
        try { return object === null || object === undefined ? undefined : object[property]; }
        catch (error) { return undefined; }
    }
    function length(collection) {
        var n = get(collection, "length");
        return typeof n === "number" && isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
    function number(value) {
        return typeof value === "number" && isFinite(value) ? value : null;
    }
    function string(value, fallback) {
        try { return value === undefined || value === null || value === "" ? fallback : String(value); }
        catch (error) { return fallback; }
    }
    function notice(severity, message) {
        var key = "$" + severity + ":" + message;
        if (!noticeKeys[key]) { noticeKeys[key] = true; out.extra.push({ severity: severity, message: message }); }
    }
    function bounds(value) {
        if (length(value) !== 4) { return null; }
        var left = number(get(value, 0)), top = number(get(value, 1));
        var right = number(get(value, 2)), bottom = number(get(value, 3));
        if (left === null || top === null || right === null || bottom === null) { return null; }
        return [Math.min(-top, -bottom), Math.min(left, right), Math.max(-top, -bottom), Math.max(left, right)];
    }
    function itemBounds(item) { return bounds(get(item, "visibleBounds")) || bounds(get(item, "geometricBounds")); }
    function intersects(a, b) { return a[1] <= b[3] && a[3] >= b[1] && a[0] <= b[2] && a[2] >= b[0]; }
    function label(item, fallback) { return string(get(item, "name"), fallback); }
    function typename(item) { return string(get(item, "typename"), "Unknown"); }
    function unknownInk() { return { space: "Unknown", values: [], name: "" }; }
    function componentValues(color, properties) {
        var values = [], i, value;
        for (i = 0; i < properties.length; i += 1) {
            value = number(get(color, properties[i]));
            if (value === null) { return null; }
            values.push(value);
        }
        return values;
    }
    function addSpot(name) {
        if (!name) { return; }
        var key = "$" + name;
        if (!spotNames[key]) { spotNames[key] = true; out.spots.push({ name: name, used: null }); }
    }
    function spotModel(spot) {
        var model = get(spot, "colorType"), names = ["PROCESS", "SPOT", "REGISTRATION"], i;
        for (i = 0; i < names.length; i += 1) {
            try {
                if (typeof ColorModel !== "undefined" && ColorModel[names[i]] !== undefined && model === ColorModel[names[i]]) { return names[i]; }
            } catch (error) {}
        }
        var name = string(model, "").toUpperCase().replace(/^COLORMODEL\./, "");
        if (name === "PROCESS" || name === "SPOT" || name === "REGISTRATION") { return name; }
        return "Unknown";
    }
    function inventorySpot(spot, index) {
        var name = string(get(spot, "name"), "견본 " + (index + 1)), model = spotModel(spot);
        if (model === "SPOT") { addSpot(name); }
        else if (model === "REGISTRATION") { notice("확인 필요", name + ": 레지스트레이션(Registration) 견본입니다. 실제 사용 여부와 모든 잉크판 출력을 확인하세요."); }
        else if (model === "Unknown") { notice("확인 필요", name + ": colorType 색상 모델을 읽지 못해 프로세스·별색·레지스트레이션을 구분할 수 없습니다."); }
    }
    function readInk(color, objectLabel, depth) {
        depth = typeof depth === "number" ? depth : 0;
        if (depth > 8) { notice("확인 필요", objectLabel + ": 색상 참조가 너무 깊거나 반복되어 실제 잉크를 읽지 못했습니다."); return unknownInk(); }
        var type = typename(color), values, name = "";
        if (type === "NoColor") { return { space: "None", values: [], name: "" }; }
        if (type === "CMYKColor") {
            values = componentValues(color, ["cyan", "magenta", "yellow", "black"]);
            if (values) { return { space: "CMYK", values: values, name: "" }; }
        } else if (type === "RGBColor") {
            values = componentValues(color, ["red", "green", "blue"]);
            if (values) { return { space: "RGB", values: values, name: "" }; }
        } else if (type === "GrayColor") {
            values = componentValues(color, ["gray"]);
            if (values) { return { space: "Gray", values: values, name: "" }; }
        } else if (type === "SpotColor") {
            var spot = get(color, "spot"), model = spotModel(spot);
            name = string(get(spot, "name"), "");
            if (model === "REGISTRATION") {
                notice("주의", objectLabel + ": 레지스트레이션(Registration) 색상 " + name + "을 사용합니다. 일반 검정 잉크로 판정하지 않으며 모든 잉크판 출력을 확인하세요.");
                return unknownInk();
            }
            if (model === "Unknown") {
                notice("확인 필요", objectLabel + ": " + name + "의 colorType 색상 모델을 읽지 못해 실제 잉크를 판정할 수 없습니다.");
                return unknownInk();
            }
            values = componentValues(color, ["tint"]);
            if (model === "SPOT") { addSpot(name); }
            if (!values || values[0] < 0 || values[0] > 100) {
                notice("확인 필요", objectLabel + ": " + name + "의 틴트 농도(tint)를 읽지 못했거나 0–100% 범위를 벗어납니다.");
                return unknownInk();
            }
            if (model === "SPOT") { return { space: "Spot", values: values, name: name }; }
            var base = readInk(get(spot, "color"), objectLabel, depth + 1), tinted = [], factor = values[0] / 100, i;
            if (base.space === "CMYK" || base.space === "RGB") {
                for (i = 0; i < base.values.length; i += 1) {
                    tinted.push(base.space === "RGB" ? 255 - (255 - base.values[i]) * factor : base.values[i] * factor);
                }
                return { space: base.space, values: tinted, name: base.name };
            }
            notice("확인 필요", objectLabel + ": 글로벌 프로세스 색상 " + name + "의 실제 잉크와 틴트 농도는 원본 및 분판에서 확인하세요.");
            return unknownInk();
        } else if (type === "GradientColor") {
            notice("확인 필요", objectLabel + ": 그라디언트(Gradient) 내부 색상과 별색은 원본 및 최종 PDF에서 확인하세요.");
            return unknownInk();
        } else if (type === "PatternColor") {
            notice("확인 필요", objectLabel + ": 패턴(Pattern) 내부 색상과 별색은 원본 및 최종 PDF에서 확인하세요.");
            return unknownInk();
        }
        notice("확인 필요", objectLabel + ": 일부 색상 값을 읽을 수 없어 색상과 분판 확인이 필요합니다.");
        return unknownInk();
    }
    function hasVisibleStroke(item, itemLabel) {
        if (get(item, "stroked") !== true) { return false; }
        var ink = readInk(get(item, "strokeColor"), itemLabel);
        return ink.space !== "None" && ink.space !== "Unknown";
    }
    function inspectShapeInk(color, itemLabel) {
        var ink = readInk(color, itemLabel);
        if (ink.space === "RGB") { notice("주의", itemLabel + ": 실제 경로 채움 또는 획에 RGB 색상이 있습니다. 최종 CMYK 변환 결과를 확인하세요."); }
        if (ink.space === "Spot") { notice("확인 필요", itemLabel + ": 실제 경로 채움 또는 획에 별색 " + ink.name + "이 있습니다. 의도된 별색·후가공 용도와 최종 분판을 확인하세요."); }
    }
    function straightRectangle(item, box) {
        if (typename(item) !== "PathItem" || get(item, "closed") !== true || !box) { return false; }
        var points = get(item, "pathPoints"), corners = {}, i, p, anchor, left, right, x, y, sideX, sideY, key;
        if (length(points) !== 4 || box[1] === box[3] || box[0] === box[2]) { return false; }
        for (i = 0; i < 4; i += 1) {
            p = get(points, i); anchor = get(p, "anchor"); left = get(p, "leftDirection"); right = get(p, "rightDirection");
            if (length(anchor) !== 2 || length(left) !== 2 || length(right) !== 2) { return false; }
            x = number(get(anchor, 0)); y = number(get(anchor, 1));
            if (x === null || y === null) { return false; }
            if (get(left, 0) !== x || get(left, 1) !== y || get(right, 0) !== x || get(right, 1) !== y) { return false; }
            sideX = Math.abs(x - box[1]) <= 0.01 ? 0 : (Math.abs(x - box[3]) <= 0.01 ? 1 : -1);
            sideY = Math.abs(-y - box[0]) <= 0.01 ? 0 : (Math.abs(-y - box[2]) <= 0.01 ? 1 : -1);
            if (sideX < 0 || sideY < 0) { return false; }
            key = "$" + sideX + ":" + sideY;
            if (corners[key]) { return false; }
            corners[key] = true;
        }
        /* The corner sequence must be perimeter edges, not a crossed bow-tie. */
        for (i = 0; i < 4; i += 1) {
            anchor = get(get(points, i), "anchor"); p = get(get(points, (i + 1) % 4), "anchor");
            if (get(anchor, 0) !== get(p, 0) && get(anchor, 1) !== get(p, 1)) { return false; }
        }
        return true;
    }
    function borderNearPage(item, box, pageBox, strokePt, itemLabel) {
        if (strokePt === null || strokePt <= 0 || !hasVisibleStroke(item, itemLabel) || !straightRectangle(item, box)) { return false; }
        var i;
        for (i = 0; i < 4; i += 1) { if (Math.abs(box[i] - pageBox[i]) > edgeTolerancePt) { return false; } }
        return true;
    }
    function addFont(font, objectLabel) {
        var name = string(get(font, "name"), "");
        if (!name) { notice("확인 필요", objectLabel + ": 폰트 이름을 읽지 못했습니다. 누락·대체 폰트를 확인하세요."); return ""; }
        var key = "$" + name;
        if (!fontNames[key]) { fontNames[key] = true; out.fonts.push({ name: name, status: "unknown", embedAllowed: null }); }
        return name;
    }
    function inkKey(ink) { return ink.space + ":" + ink.values.join(",") + ":" + ink.name; }
    function collectText(frame, frameLabel) {
        var chars = get(frame, "characters"), count = length(chars), i, attrs, fill, stroke, size, font, key, previous = null;
        if (!chars) { notice("확인 필요", frameLabel + ": 문자 속성을 읽지 못했습니다. 실제 글자 색상과 크기를 확인하세요."); return; }
        for (i = 0; i < count; i += 1) {
            if (scannedCharacters >= characterLimit) { capped = true; break; }
            scannedCharacters += 1;
            attrs = get(get(chars, i), "characterAttributes");
            fill = readInk(get(attrs, "fillColor"), frameLabel);
            stroke = readInk(get(attrs, "strokeColor"), frameLabel);
            size = number(get(attrs, "size"));
            if (size === null) { notice("확인 필요", frameLabel + ": 일부 글자 크기를 읽지 못했습니다."); }
            font = addFont(get(attrs, "textFont"), frameLabel);
            key = String(size) + "|" + inkKey(fill) + "|" + inkKey(stroke) + "|" + font;
            if (key !== previous) { out.texts.push({ label: frameLabel + " 문자 " + (i + 1), sizePt: size, ink: fill, strokeInk: stroke }); }
            previous = key;
        }
    }
    function imageSpace(value) {
        try {
            if (typeof ImageColorSpace !== "undefined") {
                if (ImageColorSpace.CMYK !== undefined && value === ImageColorSpace.CMYK) { return "CMYK"; }
                if (ImageColorSpace.RGB !== undefined && value === ImageColorSpace.RGB) { return "RGB"; }
                if (ImageColorSpace.GrayScale !== undefined && value === ImageColorSpace.GrayScale) { return "Gray"; }
                if (ImageColorSpace.Grayscale !== undefined && value === ImageColorSpace.Grayscale) { return "Gray"; }
            }
        } catch (error) {}
        var text = string(value, "").toUpperCase().replace(/^IMAGECOLORSPACE\./, "");
        if (text === "CMYK") { return "CMYK"; }
        if (text === "RGB") { return "RGB"; }
        if (text === "GRAY" || text === "GREY" || text === "GRAYSCALE" || text === "GREYSCALE") { return "Gray"; }
        return "Unknown";
    }
    function placedVector(item) {
        var fileName = string(get(get(item, "file"), "name"), "");
        return /\.(pdf|eps|svg|svgz|ai)$/i.test(fileName);
    }
    function collectItem(item, index) {
        if (!item) { return; }
        var i;
        for (i = 0; i < visited.length; i += 1) { if (visited[i] === item) { return; } }
        visited.push(item);
        var type = typename(item), itemLabel = label(item, type + " " + (index + 1));
        var box = itemBounds(item), geometricBox = bounds(get(item, "geometricBounds")), kind = "other", strokePt = null, assigned = false, page;
        if (type === "TextFrame") { kind = "text"; collectText(item, itemLabel); }
        else if (type === "PathItem" || type === "CompoundPathItem") { kind = "shape"; }
        else if (type === "RasterItem") { kind = "image"; }
        else if (type === "PlacedItem" && !placedVector(item)) { kind = "image"; }
        if (type === "PathItem") {
            if (get(item, "stroked") === true) { strokePt = number(get(item, "strokeWidth")); inspectShapeInk(get(item, "strokeColor"), itemLabel); }
            else if (get(item, "stroked") === false) { strokePt = 0; }
            if (get(item, "filled") === true) { inspectShapeInk(get(item, "fillColor"), itemLabel); }
        }
        if (!box) { notice("확인 필요", itemLabel + ": 객체 경계를 읽지 못해 재단 거리와 아트보드 배치를 확인할 수 없습니다."); }
        for (i = 0; i < out.pages.length; i += 1) {
            page = out.pages[i];
            if (box && intersects(box, page.boundsPt)) {
                out.items.push({ label: itemLabel, pageLabel: page.label, boundsPt: box, kind: kind, strokePt: strokePt,
                    borderCandidate: borderNearPage(item, geometricBox, page.boundsPt, strokePt, itemLabel) });
                assigned = true;
            }
        }
        if (!assigned) { out.items.push({ label: itemLabel, pageLabel: null, boundsPt: box, kind: kind, strokePt: strokePt, borderCandidate: false }); }
        if (type === "RasterItem") {
            var space = imageSpace(get(item, "imageColorSpace"));
            if (space === "Unknown") { space = imageSpace(get(item, "rasterImageColorSpace")); }
            out.images.push({ label: itemLabel, ppi: null, space: space });
            notice("확인 필요", itemLabel + ": Illustrator 스크립트로 최종 배치의 유효 PPI를 확인할 수 없습니다. 원본 픽셀 수와 배치 크기로 해상도를 확인하세요.");
            if (space === "Unknown") { notice("확인 필요", itemLabel + ": 래스터 이미지 색 공간을 읽지 못했습니다. CMYK 변환 여부를 확인하세요."); }
        } else if (type === "PlacedItem") {
            if (placedVector(item)) {
                notice("확인 필요", itemLabel + ": 배치된 PDF/EPS/SVG/AI의 내부 벡터·텍스트·이미지 색상과 해상도는 별도 확인이 필요합니다.");
            } else {
                out.images.push({ label: itemLabel, ppi: null, space: "Unknown" });
                notice("확인 필요", itemLabel + ": 배치 파일의 픽셀 수·유효 PPI와 색 공간은 스크립트로 확인할 수 없습니다. 원본 및 최종 출력 파일에서 확인하세요.");
            }
        } else if (type === "MeshItem" || type === "SymbolItem" || type === "PluginItem" || type === "NonNativeItem" || type === "GraphItem") {
            notice("확인 필요", itemLabel + ": " + type + " 내부 색상·별색·이미지·효과는 자동 수집 범위 밖이므로 별도 확인하세요.");
        } else if (kind === "other" && type !== "GroupItem") {
            notice("확인 필요", itemLabel + ": 미지원 객체 유형 " + type + "의 색상과 출력 상태를 확인하세요.");
        }
        if (get(item, "clipping") === true || get(item, "clipped") === true) {
            notice("확인 필요", itemLabel + ": 클리핑 경계와 실제 보이는 내용의 재단·도련 범위를 확인하세요.");
        }
        if (type === "GroupItem") { collectCollection(get(item, "pageItems"), itemLabel + " 내부 객체"); }
        if (type === "CompoundPathItem") { collectCollection(get(item, "pathItems"), itemLabel + " 내부 경로"); }
    }
    function collectCollection(collection, collectionLabel) {
        if (!collection || number(get(collection, "length")) === null) {
            notice("확인 필요", collectionLabel + ": 객체 목록을 읽지 못했습니다. 해당 내용은 검사되지 않았으므로 원본에서 확인하세요.");
            return;
        }
        var count = length(collection), i;
        for (i = 0; i < count; i += 1) {
            var item = get(collection, i);
            if (!item) { notice("확인 필요", collectionLabel + " " + (i + 1) + ": 객체를 읽지 못했습니다."); }
            else { collectItem(item, i); }
        }
    }

    out.documentName = string(get(doc, "name"), "이름 없는 문서");
    var artboards = get(doc, "artboards"), count = length(artboards), i, board, boardBounds;
    for (i = 0; i < count; i += 1) {
        board = get(artboards, i); boardBounds = bounds(get(board, "artboardRect"));
        if (boardBounds) {
            var boardLabel = label(board, "아트보드 " + (i + 1));
            while (pageLabels["$" + boardLabel]) { boardLabel += " (아트보드 " + (i + 1) + ")"; }
            pageLabels["$" + boardLabel] = true;
            out.pages.push({ label: boardLabel, boundsPt: boardBounds, bleedPt: null });
        }
        else { notice("확인 필요", "아트보드 " + (i + 1) + ": 경계를 읽지 못했습니다."); }
    }
    if (count === 0) { notice("확인 필요", "아트보드 경계를 읽지 못했습니다."); }
    var documentSpace = get(doc, "documentColorSpace"), rgbDocument = false;
    try { rgbDocument = typeof DocumentColorSpace !== "undefined" && DocumentColorSpace.RGB !== undefined && documentSpace === DocumentColorSpace.RGB; }
    catch (error) {}
    if (string(documentSpace, "").toUpperCase().replace(/^DOCUMENTCOLORSPACE\./, "") === "RGB") { rgbDocument = true; }
    if (rgbDocument) { notice("주의", "RGB 문서 모드입니다. 문서 모드와 별도로 실제 객체 색상 및 최종 PDF의 CMYK 변환 결과를 확인하세요."); }
    var spots = get(doc, "spots");
    for (i = 0; i < length(spots); i += 1) { inventorySpot(get(spots, i), i); }
    collectCollection(get(doc, "pageItems"), "전체 객체");
    collectCollection(get(doc, "textFrames"), "텍스트 프레임");
    collectCollection(get(doc, "rasterItems"), "래스터 객체");
    collectCollection(get(doc, "placedItems"), "배치 객체");
    if (capped) { notice("확인 필요", "문자 검사 제한 30000자에 도달했습니다. 검사하지 못한 나머지 글자의 크기·잉크·폰트를 원본에서 확인하세요."); }
    out.coverage.push("아트보드 경계를 재단선 후보로 사용합니다. 도련 값과 실제 배경 채움, 최종 PDF의 재단·도련 박스를 별도로 확인하세요.");
    out.coverage.push("객체는 경계가 겹치는 모든 아트보드에 기록합니다. 글자는 프레임 경계 기준 후보이며 실제 글자와 중요 로고의 재단 거리는 시각 확인이 필요합니다.");
    out.coverage.push("인접 문자 중 같은 크기·채움·획·폰트 속성은 하나의 기록으로 묶습니다. 실제 문자 속성을 최대 30000자까지 읽습니다.");
    out.coverage.push("글자 윤곽선, 폰트 누락·대체 상태 및 최종 PDF의 폰트 포함·임베딩 권한은 Illustrator 수집으로 인증하지 않습니다.");
    out.coverage.push("래스터 효과 설정의 해상도는 배치 이미지 유효 PPI가 아닙니다. 래스터·링크 이미지 유효 PPI는 픽셀 수와 최종 배치 크기로 확인하세요.");
    out.coverage.push("별색 목록은 스와치와 발견한 문자·경로 색상을 포함하며 사용 여부는 알 수 없습니다. 의도된 별색과 최종 분판을 확인하세요.");
    out.coverage.push("직선 직사각형 경로가 모든 아트보드 변에서 5mm 이내인 경우만 외곽 테두리 후보입니다. 브러시·효과·확대 및 실제 출력 획 두께는 최종 PDF에서 확인하세요.");
    out.coverage.push("그라디언트·패턴·메시·심볼·효과·배치 벡터 내부 및 비지원 객체는 수동 확인 대상입니다. 전체 파일의 RGB·별색 부재와 PDF/X 적합성을 인증하지 않습니다.");
    return out;
}

/* ScriptUI native modal; no network, no automatic artwork modification. */
function runPrintPreflight() {
    var name=String(app.name), isID=/indesign/i.test(name), isAI=/illustrator/i.test(name);
    if(!isID && !isAI) {alert('InDesign 또는 Illustrator 안에서 실행해 주세요.');return;}
    if(app.documents.length===0) {alert('점검할 인쇄 문서를 먼저 열어 주세요.\n그다음 LAYA 인쇄 점검을 다시 실행하세요.');return;}
    var doc=app.activeDocument;
    var setup=new Window('dialog','LAYA 인쇄 점검 — 기준 설정');
    setup.orientation='column';setup.alignChildren='fill';setup.spacing=12;setup.margins=18;
    setup.add('statictext',undefined,'현재 열린 원본을 읽어 8가지 인쇄 유의사항을 점검합니다.');
    setup.add('statictext',undefined,'인쇄소 기준을 입력하세요. 빈칸 항목은 직접 확인할 사항으로 남습니다.');
    function field(label,value) {var g=setup.add('group');g.add('statictext',undefined,label).preferredSize.width=200;var t=g.add('edittext',undefined,value);t.characters=16;return t;}
    var safety=field('안전 여백 (mm, 원문 3–5)', '3');
    var bleed=field('인쇄소 도련 폭 (mm, 선택)', '');
    var small=field('작은 글자 크기 (pt, 선택)', '');
    var ppi=field('최소 유효 이미지 PPI', '300');
    var spots=field('의도된 별색 이름 (쉼표 구분)', '');
    var g=setup.add('group');g.add('statictext',undefined,'납품 방식').preferredSize.width=200;
    var delivery=g.add('dropdownlist',undefined,['인쇄용 PDF','PDF 외 낱장 표지·명함 원본','그 밖의 원본']);delivery.selection=0;
    var buttons=setup.add('group');buttons.alignment='right';buttons.add('button',undefined,'취소',{name:'cancel'});var start=buttons.add('button',undefined,'점검 시작',{name:'ok'});
    var job=null;
    function clean(s) {return String(s).replace(/^\s+|\s+$/g,'');}
    function number(t,optional,zero) {var s=clean(t.text);if(s==='' && optional)return null;var n=Number(s);if(s==='' || !isFinite(n) || (zero?n<0:n<=0))throw Error('숫자 입력을 확인해 주세요.');return n;}
    start.onClick=function() {try{
        var allowed=[],arr=clean(spots.text).split(','),i;
        for(i=0;i<arr.length;i++) if(clean(arr[i])!=='')allowed.push(clean(arr[i]));
        job={safetyMm:number(safety,false,true),bleedMm:number(bleed,true,true),smallTextPt:number(small,true,false),minPpi:number(ppi,false,false),allowedSpots:allowed,delivery:['pdf','singleOriginal','otherOriginal'][delivery.selection.index]};
        setup.close(1);
    }catch(e){alert(e.message);}};
    if(setup.show()!==1 || !job) return;
    var snapshot,result;
    try {snapshot=isID?collectInDesign(doc):collectIllustrator(doc);result=evaluatePreflight(snapshot,job);}
    catch(e) {alert('점검을 완료하지 못했습니다.\n'+e.message+'\n원본의 자동 수정을 시도하지 않았습니다.');return;}
    var win=new Window('dialog','LAYA 인쇄 점검 — '+snapshot.documentName);
    win.orientation='column';win.alignChildren='fill';win.spacing=10;win.margins=16;
    win.add('statictext',undefined,'원본 부분 점검 · 최종 PDF와 인쇄소 사양의 추가 확인이 필요합니다.');
    var list=win.add('listbox',undefined,[],{numberOfColumns:2,showHeaders:true,columnTitles:['점검 항목','상태'],columnWidths:[340,115]});list.preferredSize=[640,190];
    var i,entry;for(i=0;i<result.rules.length;i++) {entry=list.add('item',(i+1)+'. '+result.rules[i].title);entry.subItems[0].text=result.rules[i].status;}
    var extra=list.add('item','추가 점검 · 검사 범위');extra.subItems[0].text='확인 필요';
    var detail=win.add('edittext',undefined,'',{multiline:true,readonly:true,scrolling:true});detail.preferredSize=[640,230];
    list.onChange=function(){var index=list.selection?list.selection.index:0,a,j,lines=[];
        if(index<8) {a=result.rules[index];lines.push(a.title+' — '+a.status,'');for(j=0;j<a.details.length;j++)lines.push(a.details[j]);}
        else {for(j=0;j<result.extra.length;j++)lines.push('['+result.extra[j].severity+'] '+result.extra[j].message);for(j=0;j<result.coverage.length;j++)lines.push(result.coverage[j]);lines.push('최종 PDF의 글꼴 포함·분판·도련 채움을 별도로 확인하세요.');}
        detail.text=lines.join('\n');
    };list.selection=0;list.onChange();
    var footer=win.add('group');footer.alignment='right';
    var save=footer.add('button',undefined,'보고서 저장');footer.add('button',undefined,'닫기',{name:'ok'});
    save.onClick=function(){
        var file=File.saveDialog('점검 보고서를 TXT로 저장','텍스트 파일:*.txt');if(!file)return;
        if(!/\.txt$/i.test(file.name)){alert('원본 보호를 위해 .txt 파일로만 보고서를 저장합니다.');return;}
        try {if(doc.saved && String(file.fsName)===String(doc.fullName.fsName)){alert('원본 파일에는 보고서를 저장할 수 없습니다.');return;}}catch(ignore){}
        if(file.exists && !confirm('같은 이름의 보고서가 있습니다. 덮어쓸까요?'))return;
        file.encoding='UTF-8';if(!file.open('w')){alert('파일을 저장할 수 없습니다. 다른 위치를 선택해 주세요.');return;}
        try {file.write('\uFEFF'+preflightReportText(result));}finally{file.close();}
        alert('점검 보고서를 저장했습니다.');
    };
    win.show();
}
if(typeof app!=='undefined') runPrintPreflight();
