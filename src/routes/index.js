const { Router } = require('express');
const crawlRouter = require('./crawl');
const searchRouter = require('./search');

const router = Router();

router.use(crawlRouter);
router.use(searchRouter);

module.exports = router;
