/**
 * jewish-date + gematriya browser bundle
 * Exposes: window.jewishDate
 */
(function() {
  // gematriya
  var module = { exports: {} };
  var exports = module.exports;
/*
 * Convert numbers to gematriya representation, and vice-versa.
 *
 * Licensed MIT.
 *
 * Copyright (c) 2014 Eyal Schachter

 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

(function(){
	var letters = {}, numbers = {
		'': 0,
		א: 1,
		ב: 2,
		ג: 3,
		ד: 4,
		ה: 5,
		ו: 6,
		ז: 7,
		ח: 8,
		ט: 9,
		י: 10,
		כ: 20,
		ל: 30,
		מ: 40,
		נ: 50,
		ס: 60,
		ע: 70,
		פ: 80,
		צ: 90,
		ק: 100,
		ר: 200,
		ש: 300,
		ת: 400,
		תק: 500,
		תר: 600,
		תש: 700,
		תת: 800,
		תתק: 900,
		תתר: 1000
	}, i;
	for (i in numbers) {
		letters[numbers[i]] = i;
	}

	function gematriya(num, options) {
		if (options === undefined) {
			var options = {limit: false, punctuate: true, order: false, geresh: true};
		}

		if (typeof num !== 'number' && typeof num !== 'string') {
			throw new TypeError('non-number or string given to gematriya()');
		}

		if (typeof options !== 'object' || options === null){
			throw new TypeError('An object was not given as second argument')
		}

		var limit = options.limit;
		var order = options.order;
		var punctuate = typeof options.punctuate === 'undefined' ? true : options.punctuate;
		var geresh = typeof options.geresh === 'undefined' && punctuate ? true : options.geresh;

		var str = typeof num === 'string';

		if (str) {
			num = num.replace(/('|")/g,'');
		}
		num = num.toString().split('').reverse();
		if (!str && limit) {
			num = num.slice(0, limit);
		}

		num = num.map(function g(n,i){
			if (str) {
				return order && numbers[n] < numbers[num[i - 1]] && numbers[n] < 100 ? numbers[n] * 1000 : numbers[n];
			} else {
				if (parseInt(n, 10) * Math.pow(10, i) > 1000) {
					return g(n, i-3);
				}
				return letters[parseInt(n, 10) * Math.pow(10, i)];
			}
		});

		if (str) {
			return num.reduce(function(o,t){
				return o + t;
			}, 0);
		} else {
			num = num.reverse().join('').replace(/יה/g,'טו').replace(/יו/g,'טז').split('');

			if (punctuate || geresh)	{
				if (num.length === 1) {
					num.push(geresh ? '׳' : "'");
				} else if (num.length > 1) {
					num.splice(-1, 0, geresh ? '״' : '"');
				}
			}

			return num.join('');
		}
	}

	if (typeof module !== 'undefined') {
		module.exports = gematriya;
	} else {
		window.gematriya = gematriya;
	}
})();

  var _gematriya = module.exports;

  // jewish-date (no require needed)
  var _jewishDateExports;
var L=Object.create;var p=Object.defineProperty;var W=Object.getOwnPropertyDescriptor;var z=Object.getOwnPropertyNames;var G=Object.getPrototypeOf,q=Object.prototype.hasOwnProperty;var U=(e,t)=>{for(var o in t)p(e,o,{get:t[o],enumerable:!0})},I=(e,t,o,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of z(t))!q.call(e,a)&&a!==o&&p(e,a,{get:()=>t[a],enumerable:!(r=W(t,a))||r.enumerable});return e};var Q=(e,t,o)=>(o=e!=null?L(G(e)):{},I(t||!e||!e.__esModule?p(o,"default",{value:e,enumerable:!0}):o,e)),V=e=>I(p({},"__esModule",{value:!0}),e);var me={};U(me,{JewishMonth:()=>n,calcDaysInMonth:()=>se,convertNumberToHebrew:()=>w,convertYearToShortHebrew:()=>C,formatJewishDate:()=>ne,formatJewishDateInHebrew:()=>he,getIndexByJewishMonth:()=>M,getJewishMonthByIndex:()=>R,getJewishMonthInHebrew:()=>N,getJewishMonthsInOrder:()=>j,isLeapYear:()=>x,toGregorianDate:()=>ae,toHebrewJewishDate:()=>ie,toJewishDate:()=>oe});var _jewishDateExports = me;var n={None:"None",Tishri:"Tishri",Cheshvan:"Cheshvan",Kislev:"Kislev",Tevet:"Tevet",Shevat:"Shevat",Adar:"Adar",Nisan:"Nisan",Iyyar:"Iyyar",Sivan:"Sivan",Tammuz:"Tammuz",Av:"Av",Elul:"Elul",AdarI:"AdarI",AdarII:"AdarII"};var D=17214255e-1,X=347995.5;function d(e,t){return e-t*Math.floor(e/t)}function E(e){return e%4===0&&!(e%100===0&&e%400!==0)}function b(e,t,o){return D-1+365*(e-1)+Math.floor((e-1)/4)+-Math.floor((e-1)/100)+Math.floor((e-1)/400)+Math.floor((367*t-362)/12+(t<=2?0:E(e)?-1:-2)+o)}function S(e){let t=Math.floor(e-.5)+.5,o=t-D,r=Math.floor(o/146097),a=d(o,146097),s=Math.floor(a/36524),i=d(a,36524),h=Math.floor(i/1461),m=d(i,1461),g=Math.floor(m/365),u=r*400+s*100+h*4+g;s===4||g===4||u++;let _=t-b(u,1,1),O=t<b(u,3,1)?0:E(u)?1:2,A=Math.floor(((_+O)*12+373)/367),K=t-b(u,A,1)+1;return[u,A,K]}function Y(e){return d(e*7+1,19)<7}function Z(e){return Y(e)?13:12}function l(e){let t=Math.floor((235*e-234)/19),o=12084+13753*t,r=t*29+Math.floor(o/25920);return d(3*(r+1),7)<3&&r++,r}function $(e){let t=l(e-1),o=l(e);return l(e+1)-o===356?2:o-t===382?1:0}function v(e){return c(e+1,7,1)-c(e,7,1)}function y(e,t){return t===2||t===4||t===6||t===10||t===13||t===12&&!Y(e)||t===8&&d(v(e),10)!==5||t===9&&d(v(e),10)===3?29:30}function c(e,t,o){let r,a=Z(e),s=X+l(e)+$(e)+o+1;if(t<7){for(r=7;r<=a;r++)s+=y(e,r);for(r=1;r<t;r++)s+=y(e,r)}else for(r=7;r<t;r++)s+=y(e,r);return s}function H(e){let o,r,a=Math.floor(e)+.5,s=Math.floor((a-347995.5)*98496/35975351);o=s-1;for(let m=s;a>=c(m,7,1);m++)o++;let i=a<c(o,1,1)?7:1;r=i;for(let m=i;a>c(o,m,y(o,m));m++)r++;let h=a-c(o,r,1)+1;return[o,r,h]}var f=(e,t)=>e.toString().padStart(t,"0");var ee=["yyyy","YYYY","yy","YY","MMMM","MM","M","dd","D","d"],te=()=>({d:e=>e.day.toString(),dd:e=>f(e.day,2),D:e=>e.day.toString(),M:e=>e.month.toString(),MM:e=>f(e.month,2),MMMM:e=>e.monthName,yy:e=>(e.year%100).toString().padStart(2,"0"),YY:e=>(e.year%100).toString().padStart(2,"0"),yyyy:e=>e.year.toString(),YYYY:e=>e.year.toString()}),k=(e,t,o)=>({d:r=>r.day.toString(),dd:r=>f(r.day,2),D:r=>e(r.day),M:r=>r.month.toString(),MM:r=>f(r.month,2),MMMM:r=>t(r.monthName),yy:r=>(r.year%100).toString().padStart(2,"0"),YY:r=>o(r.year),yyyy:r=>r.year.toString(),YYYY:r=>e(r.year)}),re=e=>{let t=[],o=0;for(;o<e.length;){let r=null;for(let a of ee){let s=e.indexOf(a,o);if(s===o){r={token:a,index:s};break}}r?(t.push(r),o=r.index+r.token.length):o++}return t},T=(e,t,o)=>{let r=re(e),a="",s=0;for(let{token:i,index:h}of r)h>s&&(a+=e.slice(s,h)),a+=o[i](t),s=h+i.length;return s<e.length&&(a+=e.slice(s)),a},F="d MMMM yyyy",B="D MMMM YYYY",P=te();var x=e=>{let t=e%19;return t===0||t===3||t===6||t===8||t===11||t===14||t===17},M=e=>({[n.None]:0,[n.Tishri]:7,[n.Cheshvan]:8,[n.Kislev]:9,[n.Tevet]:10,[n.Shevat]:11,[n.Adar]:12,[n.AdarI]:12,[n.AdarII]:13,[n.Nisan]:1,[n.Iyyar]:2,[n.Sivan]:3,[n.Tammuz]:4,[n.Av]:5,[n.Elul]:6})[e]||0,R=(e,t)=>{let r=[n.None,n.Nisan,n.Iyyar,n.Sivan,n.Tammuz,n.Av,n.Elul,n.Tishri,n.Cheshvan,n.Kislev,n.Tevet,n.Shevat,n.Adar,n.AdarII][e]||n.None;return r===n.Adar&&x(t)?n.AdarI:r},j=e=>{let t=[n.None,n.Tishri,n.Cheshvan,n.Kislev,n.Tevet,n.Shevat,n.AdarI,n.AdarII,n.Nisan,n.Iyyar,n.Sivan,n.Tammuz,n.Av,n.Elul];return x(e)?t:t.filter(o=>o!=="AdarII").map(o=>o==="AdarI"?"Adar":o)},ne=(e,t)=>T(t??F,{day:e.day,month:e.month,monthName:e.monthName,year:e.year},P),oe=e=>{let t=e.getFullYear(),o=e.getMonth()+1,r=e.getDate(),a=b(t,o,r),s=H(a),i=s[0],h=R(s[1],i),m=j(i).findIndex(u=>u===h);return{year:i,monthName:h,month:m,day:s[2]}},ae=e=>{let t=M(e.monthName),o=c(e.year,t,e.day),r=S(o),a=new Date;return a.setFullYear(r[0],r[1]-1,r[2]),a.getHours()>0&&a.setHours(0,0,0,0),a},se=(e,t)=>{let o=M(t);return y(e,o)};var J=Q(_gematriya);var N=e=>({[n.None]:"\u05DC\u05DC\u05D0",[n.Tishri]:"\u05EA\u05E9\u05E8\u05D9",[n.Cheshvan]:"\u05D7\u05E9\u05D5\u05DF",[n.Kislev]:"\u05DB\u05E1\u05DC\u05D5",[n.Tevet]:"\u05D8\u05D1\u05EA",[n.Shevat]:"\u05E9\u05D1\u05D8",[n.Adar]:"\u05D0\u05D3\u05E8",[n.AdarI]:"\u05D0\u05D3\u05E8 \u05D0",[n.AdarII]:"\u05D0\u05D3\u05E8 \u05D1",[n.Nisan]:"\u05E0\u05D9\u05E1\u05DF",[n.Iyyar]:"\u05D0\u05D9\u05D9\u05E8",[n.Sivan]:"\u05E1\u05D9\u05D5\u05DF",[n.Tammuz]:"\u05EA\u05DE\u05D5\u05D6",[n.Av]:"\u05D0\u05D1",[n.Elul]:"\u05D0\u05DC\u05D5\u05DC"})[e],w=(e,t=!0,o=!0)=>(0,J.default)(e,{geresh:t,punctuate:o}),C=e=>{let t=e%100;return(0,J.default)(t,{geresh:!0,punctuate:!0})},ie=e=>({day:w(e.day),monthName:N(e.monthName),year:w(e.year)}),he=(e,t)=>{let o=t??B,r=k(w,a=>N(a),C);return T(o,{day:e.day,month:M(e.monthName),monthName:e.monthName,year:e.year},r)};
//# sourceMappingURL=index.js.map


  window.jewishDate = _jewishDateExports;
})();
