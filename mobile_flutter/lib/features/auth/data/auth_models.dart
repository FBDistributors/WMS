class TokenResponse {
  const TokenResponse({
    required this.accessToken,
    required this.tokenType,
  });

  final String accessToken;
  final String tokenType;

  factory TokenResponse.fromJson(Map<String, Object?> json) {
    return TokenResponse(
      accessToken: json['access_token']! as String,
      tokenType: json['token_type']! as String,
    );
  }
}

class MeResponse {
  const MeResponse({
    required this.id,
    required this.username,
    required this.fullName,
    required this.role,
    required this.permissions,
  });

  final String id;
  final String username;
  final String? fullName;
  final String role;
  final List<String> permissions;

  factory MeResponse.fromJson(Map<String, Object?> json) {
    final Object? perms = json['permissions'];
    final List<String> list = perms is List
        ? perms.map((Object? e) => e.toString()).toList(growable: false)
        : const <String>[];
    return MeResponse(
      id: json['id']! as String,
      username: json['username']! as String,
      fullName: json['full_name'] as String?,
      role: json['role']! as String,
      permissions: list,
    );
  }

  ProfileRoleKind get profileKind =>
      role == 'inventory_controller' ? ProfileRoleKind.controller : ProfileRoleKind.picker;
}

enum ProfileRoleKind { picker, controller }
