import JwtUtils from '../utils/jwt-utils';
import constant from '../const/constant';

const userContext = {
	getUserId(c) {
		return c.get('user').userId;
	},

	getUser(c) {
		return c.get('user');
	},

	async getToken(c) {
		const jwt = c.req.header(constant.TOKEN_HEADER);
		const result = await JwtUtils.verifyToken(c,jwt);
		return result?.token;
	},
};
export default userContext;
