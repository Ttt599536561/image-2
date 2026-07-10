// 钱链路测试只能使用显式确认的隔离数据库，绝不回退读取项目根 .env。
import { loadDisposableTestEnv } from "../../scripts/test-env-guard";

loadDisposableTestEnv();
