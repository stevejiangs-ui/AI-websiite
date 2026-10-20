/* 出生地经度表 + 真太阳时校正
   ------------------------------------------------------------------
   为什么必须做：
   子平八字用「时柱」定人的一部分特质，而时柱按真太阳时划时辰。
   北京时间（东经 120° 的标准时）跟出生地的真太阳时差两块：

     1. 经度差：每偏离 120°E 一度差 4 分钟。
        乌鲁木齐（87.6°E）比北京时间慢约 130 分钟 —— 差两个多时辰。
     2. 均时差：地球轨道椭圆 + 黄赤交角，一年内摆动 ±16 分钟。

   两块加一起，最极端能差出 2.5 个时辰。这就是「必须有出生地」的原因。 */

/* 常用出生地经度（东经为正，西经为负）。只收省会/直辖市/港澳台与
   海外华人主要城市，够覆盖绝大多数人；找不到就用「手动填经度」。 */
export const CITIES = [
  // 华北
  { name: '北京', lon: 116.41, prov: '北京' },
  { name: '天津', lon: 117.20, prov: '天津' },
  { name: '石家庄', lon: 114.51, prov: '河北' },
  { name: '唐山', lon: 118.18, prov: '河北' },
  { name: '保定', lon: 115.46, prov: '河北' },
  { name: '邯郸', lon: 114.49, prov: '河北' },
  { name: '太原', lon: 112.55, prov: '山西' },
  { name: '大同', lon: 113.30, prov: '山西' },
  { name: '呼和浩特', lon: 111.75, prov: '内蒙古' },
  { name: '包头', lon: 109.84, prov: '内蒙古' },
  // 东北
  { name: '沈阳', lon: 123.43, prov: '辽宁' },
  { name: '大连', lon: 121.62, prov: '辽宁' },
  { name: '长春', lon: 125.32, prov: '吉林' },
  { name: '吉林', lon: 126.55, prov: '吉林' },
  { name: '哈尔滨', lon: 126.53, prov: '黑龙江' },
  { name: '齐齐哈尔', lon: 123.92, prov: '黑龙江' },
  { name: '大庆', lon: 125.10, prov: '黑龙江' },
  // 华东
  { name: '上海', lon: 121.47, prov: '上海' },
  { name: '南京', lon: 118.80, prov: '江苏' },
  { name: '苏州', lon: 120.58, prov: '江苏' },
  { name: '无锡', lon: 120.31, prov: '江苏' },
  { name: '常州', lon: 119.97, prov: '江苏' },
  { name: '南通', lon: 120.89, prov: '江苏' },
  { name: '徐州', lon: 117.28, prov: '江苏' },
  { name: '扬州', lon: 119.41, prov: '江苏' },
  { name: '杭州', lon: 120.15, prov: '浙江' },
  { name: '宁波', lon: 121.55, prov: '浙江' },
  { name: '温州', lon: 120.70, prov: '浙江' },
  { name: '绍兴', lon: 120.58, prov: '浙江' },
  { name: '金华', lon: 119.65, prov: '浙江' },
  { name: '嘉兴', lon: 120.76, prov: '浙江' },
  { name: '合肥', lon: 117.23, prov: '安徽' },
  { name: '芜湖', lon: 118.43, prov: '安徽' },
  { name: '蚌埠', lon: 117.39, prov: '安徽' },
  { name: '福州', lon: 119.30, prov: '福建' },
  { name: '厦门', lon: 118.09, prov: '福建' },
  { name: '泉州', lon: 118.68, prov: '福建' },
  { name: '漳州', lon: 117.65, prov: '福建' },
  { name: '南昌', lon: 115.86, prov: '江西' },
  { name: '赣州', lon: 114.94, prov: '江西' },
  { name: '九江', lon: 116.00, prov: '江西' },
  { name: '济南', lon: 117.12, prov: '山东' },
  { name: '青岛', lon: 120.38, prov: '山东' },
  { name: '烟台', lon: 121.45, prov: '山东' },
  { name: '潍坊', lon: 119.16, prov: '山东' },
  { name: '临沂', lon: 118.35, prov: '山东' },
  { name: '淄博', lon: 118.05, prov: '山东' },
  // 华中
  { name: '郑州', lon: 113.63, prov: '河南' },
  { name: '洛阳', lon: 112.45, prov: '河南' },
  { name: '开封', lon: 114.31, prov: '河南' },
  { name: '南阳', lon: 112.53, prov: '河南' },
  { name: '武汉', lon: 114.31, prov: '湖北' },
  { name: '宜昌', lon: 111.29, prov: '湖北' },
  { name: '襄阳', lon: 112.14, prov: '湖北' },
  { name: '长沙', lon: 112.94, prov: '湖南' },
  { name: '株洲', lon: 113.13, prov: '湖南' },
  { name: '岳阳', lon: 113.13, prov: '湖南' },
  { name: '常德', lon: 111.70, prov: '湖南' },
  // 华南
  { name: '广州', lon: 113.26, prov: '广东' },
  { name: '深圳', lon: 114.06, prov: '广东' },
  { name: '东莞', lon: 113.75, prov: '广东' },
  { name: '佛山', lon: 113.12, prov: '广东', alias: ['顺德', '南海', '禅城', '三水', '高明', '大良', '容桂', '北滘', '乐从', '龙江', '伦教', '勒流', '陈村', '杏坛', '均安'] },
  { name: '珠海', lon: 113.55, prov: '广东' },
  { name: '中山', lon: 113.39, prov: '广东' },
  { name: '惠州', lon: 114.41, prov: '广东' },
  { name: '汕头', lon: 116.68, prov: '广东' },
  { name: '湛江', lon: 110.36, prov: '广东' },
  { name: '南宁', lon: 108.37, prov: '广西' },
  { name: '桂林', lon: 110.29, prov: '广西' },
  { name: '柳州', lon: 109.41, prov: '广西' },
  { name: '海口', lon: 110.20, prov: '海南' },
  { name: '三亚', lon: 109.51, prov: '海南' },
  // 西南
  { name: '重庆', lon: 106.55, prov: '重庆' },
  { name: '成都', lon: 104.07, prov: '四川' },
  { name: '绵阳', lon: 104.68, prov: '四川' },
  { name: '宜宾', lon: 104.64, prov: '四川' },
  { name: '南充', lon: 106.11, prov: '四川' },
  { name: '贵阳', lon: 106.63, prov: '贵州' },
  { name: '遵义', lon: 106.93, prov: '贵州' },
  { name: '昆明', lon: 102.83, prov: '云南' },
  { name: '大理', lon: 100.23, prov: '云南' },
  { name: '丽江', lon: 100.23, prov: '云南' },
  { name: '拉萨', lon: 91.13, prov: '西藏' },
  // 西北
  { name: '西安', lon: 108.94, prov: '陕西' },
  { name: '宝鸡', lon: 107.14, prov: '陕西' },
  { name: '咸阳', lon: 108.71, prov: '陕西' },
  { name: '榆林', lon: 109.73, prov: '陕西' },
  { name: '兰州', lon: 103.83, prov: '甘肃' },
  { name: '天水', lon: 105.72, prov: '甘肃' },
  { name: '西宁', lon: 101.78, prov: '青海' },
  { name: '银川', lon: 106.23, prov: '宁夏' },
  { name: '乌鲁木齐', lon: 87.62, prov: '新疆' },
  { name: '喀什', lon: 75.99, prov: '新疆' },
  { name: '伊宁', lon: 81.32, prov: '新疆' },
  // 港澳台
  { name: '香港', lon: 114.17, prov: '香港' },
  { name: '澳门', lon: 113.54, prov: '澳门' },
  { name: '台北', lon: 121.56, prov: '台湾' },
  { name: '高雄', lon: 120.31, prov: '台湾' },
  { name: '台中', lon: 120.68, prov: '台湾' },
  // 海外（华人常居）
  { name: '新加坡', lon: 103.82, prov: '海外' },
  { name: '吉隆坡', lon: 101.69, prov: '海外', alias: ['KL', '大马'] },
  { name: '槟城', lon: 100.33, prov: '海外' },
  { name: '曼谷', lon: 100.50, prov: '海外' },
  { name: '清迈', lon: 98.98, prov: '海外' },
  { name: '河内', lon: 105.85, prov: '海外' },
  { name: '胡志明市', lon: 106.63, prov: '海外', alias: ['西贡'] },
  { name: '马尼拉', lon: 120.98, prov: '海外' },
  { name: '雅加达', lon: 106.85, prov: '海外' },
  { name: '东京', lon: 139.69, prov: '海外' },
  { name: '大阪', lon: 135.50, prov: '海外' },
  { name: '福冈', lon: 130.40, prov: '海外' },
  { name: '首尔', lon: 126.98, prov: '海外', alias: ['汉城'] },
  { name: '迪拜', lon: 55.27, prov: '海外' },
  { name: '悉尼', lon: 151.21, prov: '海外', alias: ['雪梨'] },
  { name: '墨尔本', lon: 144.96, prov: '海外' },
  { name: '布里斯班', lon: 153.03, prov: '海外' },
  { name: '奥克兰', lon: 174.76, prov: '海外' },
  { name: '洛杉矶', lon: -118.24, prov: '海外', alias: ['LA'] },
  { name: '旧金山', lon: -122.42, prov: '海外', alias: ['三藩市', '湾区'] },
  { name: '西雅图', lon: -122.33, prov: '海外' },
  { name: '芝加哥', lon: -87.63, prov: '海外' },
  { name: '休斯顿', lon: -95.37, prov: '海外' },
  { name: '波士顿', lon: -71.06, prov: '海外' },
  { name: '纽约', lon: -74.01, prov: '海外' },
  { name: '多伦多', lon: -79.38, prov: '海外' },
  { name: '蒙特利尔', lon: -73.57, prov: '海外' },
  { name: '温哥华', lon: -123.12, prov: '海外' },
  { name: '伦敦', lon: -0.13, prov: '海外' },
  { name: '巴黎', lon: 2.35, prov: '海外' },
  { name: '柏林', lon: 13.40, prov: '海外' },
  { name: '马德里', lon: -3.70, prov: '海外' },
  { name: '米兰', lon: 9.19, prov: '海外' },
  { name: '阿姆斯特丹', lon: 4.90, prov: '海外' },
  { name: '莫斯科', lon: 37.62, prov: '海外' },
  { name: '新德里', lon: 77.21, prov: '海外' }
];

/** 按名字找城市（支持模糊：输入「苏」能匹配苏州；也认别名/区县，如「顺德」→佛山） */
export function findCity(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return null;
  const exact = CITIES.find((c) => c.name === k || (c.alias || []).some((a) => a === k));
  if (exact) return exact;
  const fuzzy = searchCities(k);
  return fuzzy[0] || null;
}

/** 城市搜索：城市名 / 省份 / 别名（含区县别名）三路匹配，供下拉候选用 */
export function searchCities(q) {
  const k = String(q || '').trim();
  if (!k) return [];
  const exact = CITIES.filter((c) => c.name === k || (c.alias || []).some((a) => a === k));
  if (exact.length) return exact;
  return CITIES.filter(
    (c) => c.name.includes(k) || c.prov.includes(k) || (c.alias || []).some((a) => a.includes(k))
  ).slice(0, 12);
}

/* ---------------- 区县经度 ---------------- */

/* 很多人的出生地是县城，不在省会表里。县级地名太多没法穷举，
   这里收的是「地名里带了方位/别名线索」时能靠搜索定位的那部分，
   更多靠下面的「地址 → 城市 → 经度」链路兜住。 */
const DISTRICT_HINTS = [
  { match: ['浦东', '黄浦', '静安', '徐汇', '长宁', '虹口', '杨浦', '闵行', '宝山', '嘉定', '松江', '青浦', '奉贤', '金山'], city: '上海' },
  { match: ['海淀', '朝阳', '东城', '西城', '丰台', '石景山', '通州', '昌平', '大兴', '顺义', '房山'], city: '北京' },
  { match: ['天河', '越秀', '海珠', '荔湾', '白云', '番禺', '黄埔', '花都', '南沙', '增城'], city: '广州' },
  { match: ['福田', '罗湖', '南山', '宝安', '龙岗', '龙华', '盐田', '光明', '坪山'], city: '深圳' },
  { match: ['顺德', '南海', '禅城', '三水', '高明'], city: '佛山' },
  { match: ['虎门', '长安', '厚街', '塘厦', '常平'], city: '东莞' },
  { match: ['小榄', '古镇', '坦洲', '南头'], city: '中山' },
  { match: ['晋江', '石狮', '南安', '惠安', '安溪'], city: '泉州' },
  { match: ['武侯', '锦江', '青羊', '金牛', '成华', '龙泉驿', '双流', '郫都', '温江'], city: '成都' },
  { match: ['西湖', '上城', '拱墅', '滨江', '萧山', '余杭', '临平', '富阳'], city: '杭州' },
  { match: ['鼓楼', '玄武', '秦淮', '建邺', '雨花台', '江宁', '浦口', '六合'], city: '南京' },
  { match: ['江岸', '江汉', '硚口', '汉阳', '武昌', '洪山', '东西湖', '蔡甸'], city: '武汉' },
  { match: ['雁塔', '碑林', '莲湖', '新城', '未央', '灞桥', '长安', '鄠邑'], city: '西安' },
  { match: ['和平', '河西', '南开', '河东', '河北', '红桥', '滨海新区'], city: '天津' },
  { match: ['渝中', '江北', '沙坪坝', '九龙坡', '南岸', '渝北', '巴南', '北碚'], city: '重庆' },
  { match: ['思明', '湖里', '集美', '海沧', '同安', '翔安'], city: '厦门' },
  { match: ['市南', '市北', '李沧', '崂山', '城阳', '黄岛'], city: '青岛' }
];

/**
 * 从一段自由文本地址里猜出生城市。
 * 先精确匹配城市名，再看区县线索，最后按「省名」兜到省会。
 * 找不到就返回 null —— 宁可让用户手填经度，也不瞎猜一个。
 */
export function inferCity(addr) {
  const s = String(addr || '');
  if (!s.trim()) return null;

  /* 1. 直接含城市名（长的优先，避免「吉林市」被「吉林」省名截） */
  const hits = CITIES.filter((c) => s.includes(c.name)).sort((a, b) => b.name.length - a.name.length);
  if (hits.length) return { city: hits[0], how: 'address' };

  /* 2. 区县线索 */
  for (const h of DISTRICT_HINTS) {
    if (h.match.some((m) => s.includes(m))) {
      const c = CITIES.find((x) => x.name === h.city);
      if (c) return { city: c, how: 'district' };
    }
  }

  /* 3. 省名 → 省会 */
  const PROV_CAP = {
    河北: '石家庄', 山西: '太原', 辽宁: '沈阳', 吉林: '长春', 黑龙江: '哈尔滨',
    江苏: '南京', 浙江: '杭州', 安徽: '合肥', 福建: '福州', 江西: '南昌',
    山东: '济南', 河南: '郑州', 湖北: '武汉', 湖南: '长沙', 广东: '广州',
    海南: '海口', 四川: '成都', 贵州: '贵阳', 云南: '昆明', 陕西: '西安',
    甘肃: '兰州', 青海: '西宁', 内蒙古: '呼和浩特', 广西: '南宁', 西藏: '拉萨',
    宁夏: '银川', 新疆: '乌鲁木齐'
  };
  for (const [prov, cap] of Object.entries(PROV_CAP)) {
    if (s.includes(prov)) {
      const c = CITIES.find((x) => x.name === cap);
      if (c) return { city: c, how: 'province' };
    }
  }
  return null;
}

/**
 * 真太阳时相对北京钟点的校正量（分钟）。
 *
 * ⚠️ 只用于「当前时区为 +8」的日期。1986–1991 夏令时期间（+9）
 *    真太阳时还要再减 60 分钟，这一项由 bazi.js 的 chinaUtcOffset 负责，
 *    这里不做判断，以免两处各算一遍反而错。
 *
 * @param {number} lon    出生地经度（东经为正）
 * @param {number} utcMs  对应的 UTC 时刻（用于算均时差）
 */
export function trueSolarOffset(lon, utcMs) {
  const eot = equationOfTime(utcMs / 86400000 + 2440587.5);
  const lonDiff = (Number(lon) - 120) * 4;
  return lonDiff + eot;
}

/* 均时差，与 astro.js 同一公式，这里内联一份避免循环依赖 */
function equationOfTime(jd) {
  const RAD = Math.PI / 180;
  const T = (jd - 2451545.0) / 36525;
  const L0 = ((280.46646 + 36000.76983 * T) % 360 + 360) % 360;
  const M = (357.52911 + 35999.05029 * T) * RAD;
  const e = 0.016708634 - 0.000042037 * T;
  const y = Math.tan((23.439291 * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const E =
    y * Math.sin(2 * L0r) -
    2 * e * Math.sin(M) +
    4 * e * y * Math.sin(M) * Math.cos(2 * L0r) -
    0.5 * y * y * Math.sin(4 * L0r) -
    1.25 * e * e * Math.sin(2 * M);
  return (E * 4 * 180) / Math.PI;
}
