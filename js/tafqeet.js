/**
 * محرك التفقيط المالي العربي الشامل والمتوافق محاسبياً
 * Comprehensive Arabic Financial Tafqeet Engine
 * يدعم الأعداد الصحيحة والكسور النقدية (فلس، هللة، سنت، قرش) وقواعد الصرف والجمع والتمييز النحوي المالي
 */

(function (global) {
  'use strict';

  const CURRENCY_DICTIONARY = {
    'ر.ي': {
      singular: 'ريال يمني',
      dual: 'ريالان يمنيان',
      plural: 'ريالات يمنية',
      accusative: 'ريالاً يمنياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'YER': {
      singular: 'ريال يمني',
      dual: 'ريالان يمنيان',
      plural: 'ريالات يمنية',
      accusative: 'ريالاً يمنياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'ر.س': {
      singular: 'ريال سعودي',
      dual: 'ريالان سعوديان',
      plural: 'ريالات سعودية',
      accusative: 'ريالاً سعودياً',
      subSingular: 'هللة',
      subDual: 'هللتان',
      subPlural: 'هللات',
      subAccusative: 'هللةً',
      decimals: 2
    },
    'SAR': {
      singular: 'ريال سعودي',
      dual: 'ريالان سعوديان',
      plural: 'ريالات سعودية',
      accusative: 'ريالاً سعودياً',
      subSingular: 'هللة',
      subDual: 'هللتان',
      subPlural: 'هللات',
      subAccusative: 'هللةً',
      decimals: 2
    },
    '$': {
      singular: 'دولار أمريكي',
      dual: 'دولاران أمريكيان',
      plural: 'دولارات أمريكية',
      accusative: 'دولاراً أمريكياً',
      subSingular: 'سنت',
      subDual: 'سنتان',
      subPlural: 'سنتات',
      subAccusative: 'سنتاً',
      decimals: 2
    },
    'USD': {
      singular: 'دولار أمريكي',
      dual: 'دولاران أمريكيان',
      plural: 'دولارات أمريكية',
      accusative: 'دولاراً أمريكياً',
      subSingular: 'سنت',
      subDual: 'سنتان',
      subPlural: 'سنتات',
      subAccusative: 'سنتاً',
      decimals: 2
    },
    'AED': {
      singular: 'درهم إماراتي',
      dual: 'درهمان إماراتيان',
      plural: 'دراهم إماراتية',
      accusative: 'درهماً إماراتياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'د.إ': {
      singular: 'درهم إماراتي',
      dual: 'درهمان إماراتيان',
      plural: 'دراهم إماراتية',
      accusative: 'درهماً إماراتياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'KWD': {
      singular: 'دينار كويتي',
      dual: 'ديناران كويتيان',
      plural: 'دنانير كويتية',
      accusative: 'ديناراً كويتياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 3
    },
    'EGP': {
      singular: 'جنيه مصري',
      dual: 'جنيهان مصريان',
      plural: 'جنيهات مصرية',
      accusative: 'جنيهاً مصرياً',
      subSingular: 'قرش',
      subDual: 'قرشان',
      subPlural: 'قروش',
      subAccusative: 'قرشاً',
      decimals: 2
    }
  };

  const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const ONES_FEMININE = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع'];
  const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const TEENS_FEMININE = ['عشر', 'إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة'];
  const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertGroup(n, isFeminine = false) {
    if (n === 0) return '';
    const res = [];
    const h = Math.floor(n / 100);
    const rem = n % 100;

    if (h > 0) {
      res.push(HUNDREDS[h]);
    }

    if (rem > 0) {
      const oArr = isFeminine ? ONES_FEMININE : ONES;
      const tArr = isFeminine ? TEENS_FEMININE : TEENS;

      if (rem < 10) {
        res.push(oArr[rem]);
      } else if (rem < 20) {
        res.push(tArr[rem - 10]);
      } else {
        const o = rem % 10;
        const t = Math.floor(rem / 10);
        if (o > 0) {
          res.push(oArr[o] + ' و' + TENS[t]);
        } else {
          res.push(TENS[t]);
        }
      }
    }

    return res.join(' و');
  }

  function numberToArabicWords(n, isFeminine = false) {
    if (n === 0) return 'صفر';
    const parts = [];

    const trillions = Math.floor(n / 1000000000000);
    n %= 1000000000000;
    const billions = Math.floor(n / 1000000000);
    n %= 1000000000;
    const millions = Math.floor(n / 1000000);
    n %= 1000000;
    const thousands = Math.floor(n / 1000);
    const units = n % 1000;

    if (trillions > 0) {
      if (trillions === 1) parts.push('تريليون');
      else if (trillions === 2) parts.push('تريليونان');
      else if (trillions >= 3 && trillions <= 10) parts.push(convertGroup(trillions, false) + ' تريليونات');
      else parts.push(convertGroup(trillions, false) + ' تريليون');
    }

    if (billions > 0) {
      if (billions === 1) parts.push('مليار');
      else if (billions === 2) parts.push('ملياران');
      else if (billions >= 3 && billions <= 10) parts.push(convertGroup(billions, false) + ' مليارات');
      else parts.push(convertGroup(billions, false) + ' مليار');
    }

    if (millions > 0) {
      if (millions === 1) parts.push('مليون');
      else if (millions === 2) parts.push('مليونان');
      else if (millions >= 3 && millions <= 10) parts.push(convertGroup(millions, false) + ' ملايين');
      else parts.push(convertGroup(millions, false) + ' مليون');
    }

    if (thousands > 0) {
      if (thousands === 1) parts.push('ألف');
      else if (thousands === 2) parts.push('ألفان');
      else if (thousands >= 3 && thousands <= 10) parts.push(convertGroup(thousands, false) + ' آلاف');
      else parts.push(convertGroup(thousands, false) + ' ألف');
    }

    if (units > 0) {
      parts.push(convertGroup(units, isFeminine));
    }

    return parts.join(' و');
  }

  function getCurrencyText(value, currDef, isFraction = false) {
    if (!currDef) return '';
    const v = Math.abs(Math.round(value));
    const rem100 = v % 100;

    if (isFraction) {
      if (v === 1) return currDef.subSingular;
      if (v === 2) return currDef.subDual;
      if (rem100 >= 3 && rem100 <= 10) return currDef.subPlural;
      return currDef.subAccusative;
    } else {
      if (v === 1) return currDef.singular;
      if (v === 2) return currDef.dual;
      if (rem100 >= 3 && rem100 <= 10) return currDef.plural;
      return currDef.accusative;
    }
  }

  function Tafqeet(amount, currency = 'ر.ي') {
    if (amount === null || amount === undefined || isNaN(amount)) return 'صفر';
    const num = Math.abs(Number(amount));
    if (num === 0) {
      const currDef = CURRENCY_DICTIONARY[currency] || CURRENCY_DICTIONARY['ر.ي'];
      return 'صفر ' + currDef.singular;
    }

    const currDef = CURRENCY_DICTIONARY[currency] || CURRENCY_DICTIONARY['ر.ي'];
    const decimals = currDef.decimals || 2;
    const fractionFactor = Math.pow(10, decimals);

    const roundedAmount = Math.round(num * fractionFactor) / fractionFactor;
    const integerPart = Math.floor(roundedAmount);
    const fractionPart = Math.round((roundedAmount - integerPart) * fractionFactor);

    const words = [];

    if (integerPart > 0) {
      const intWords = numberToArabicWords(integerPart, false);
      const currUnit = getCurrencyText(integerPart, currDef, false);

      if (integerPart === 1) {
        words.push(currDef.singular);
      } else if (integerPart === 2) {
        words.push(currDef.dual);
      } else {
        words.push(intWords + ' ' + currUnit);
      }
    }

    if (fractionPart > 0) {
      const isSubFeminine = (currDef.subSingular === 'هللة');
      const fracWords = numberToArabicWords(fractionPart, isSubFeminine);
      const fracUnit = getCurrencyText(fractionPart, currDef, true);

      if (fractionPart === 1) {
        words.push(currDef.subSingular);
      } else if (fractionPart === 2) {
        words.push(currDef.subDual);
      } else {
        words.push(fracWords + ' ' + fracUnit);
      }
    }

    if (words.length === 0) {
      return 'صفر ' + currDef.singular;
    }

    return 'فقط ' + words.join(' و') + ' لا غير';
  }

  Tafqeet.DICTIONARY = CURRENCY_DICTIONARY;
  global.Tafqeet = Tafqeet;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Tafqeet;
  }
})(typeof window !== 'undefined' ? window : global);
