    const SECONDARY_GENRE_LABELS = { "12": "冒险", "14": "奇幻", "16": "动画", "18": "剧情", "27": "恐怖", "28": "动作", "35": "喜剧", "36": "历史", "37": "西部", "53": "惊悚", "80": "犯罪", "99": "纪录片", "878": "科幻", "9648": "悬疑", "10402": "音乐", "10749": "爱情", "10751": "家庭", "10752": "战争", "10759": "动作冒险", "10762": "儿童", "10763": "新闻", "10764": "真人秀", "10765": "科幻奇幻", "10766": "肥皂剧", "10767": "脱口秀", "10768": "战争政治" };
    const SECONDARY_REGION_LABELS = { CN: "中国大陆", "HK|TW": "港台", HK: "香港", TW: "台湾", US: "美国", GB: "英国", JP: "日本", KR: "韩国", AU: "澳大利亚", CA: "加拿大", FR: "法国", DE: "德国", IN: "印度" };
    // Keep Secondary controls useful without probing every option.  Movie
    // and TV genre IDs are deliberately separate; the underlying TMDB
    // discover source remains responsible for applying the selected value.
    const SECONDARY_MOVIE_GENRE_IDS = ["28", "12", "16", "18", "35", "27", "53", "80", "878", "9648", "10749", "10751", "10752", "99", "10402"];
    const SECONDARY_TV_GENRE_IDS = ["18", "35", "80", "9648", "10749", "10751", "10759", "10765"];
    const SECONDARY_REGION_IDS = ["CN", "HK", "TW", "US", "GB", "JP", "KR", "AU", "CA", "FR", "DE", "IN"];
    const SECONDARY_TV_REGION_IDS = ["CN", "HK", "TW", "KR", "JP", "US", "GB"];
    const SECONDARY_ANIMATION_REGION_IDS = ["CN", "JP"];
    const SECONDARY_VARIETY_REGION_IDS = ["CN", "HK|TW", "KR", "JP"];
    const SECONDARY_FILTER_SCHEMA = {
      "now-playing": [],
      movie: ["genre", "region", "year", "sort"],
      tv: ["genre", "region", "year", "sort"],
      anime: ["region", "year", "sort"],
      documentary: ["year", "sort"],
      variety: ["region", "year"]
    };

