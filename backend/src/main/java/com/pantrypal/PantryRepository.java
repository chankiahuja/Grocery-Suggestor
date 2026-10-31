package com.pantrypal;

import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Repository
public class PantryRepository {
    final JdbcTemplate jdbc;
    public PantryRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public int execute(String sql, Object... args) { return jdbc.update(sql, args); }

    public List<Map<String,Object>> query(String sql, Object... args) {
        return jdbc.query(sql, (rs, n) -> {
            Map<String,Object> row = new LinkedHashMap<>();
            var metadata = rs.getMetaData();
            for (int i = 1; i <= metadata.getColumnCount(); i++) {
                String[] words = metadata.getColumnLabel(i).toLowerCase(Locale.ROOT).split("_");
                String key = words[0];
                for (int j = 1; j < words.length; j++) key += Character.toUpperCase(words[j].charAt(0)) + words[j].substring(1);
                Object value = rs.getObject(i);
                if (value instanceof Timestamp t) value = t.toInstant().toString();
                if (value instanceof OffsetDateTime t) value = t.toInstant().toString();
                if (value instanceof java.sql.Date d) value = d.toLocalDate().toString();
                if (!key.equals("restocked")) row.put(key, value);
            }
            return row;
        }, args);
    }

    public Map<String,Object> one(String sql, Object... args) {
        var rows = query(sql, args);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Resource not found");
        return rows.get(0);
    }

    public long insert(String table, Map<String,Object> values) {
        var keys = new GeneratedKeyHolder();
        String columns = String.join(",", values.keySet());
        String placeholders = String.join(",", Collections.nCopies(values.size(), "?"));
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO " + table + " (" + columns + ") VALUES (" + placeholders + ")", new String[]{"id"});
            int i = 1;
            for (Object value : values.values()) statement.setObject(i++, value);
            return statement;
        }, keys);
        return Objects.requireNonNull(keys.getKey()).longValue();
    }

    public void update(String table, long id, Map<String,Object> values) {
        if (values.isEmpty()) return;
        var args = new ArrayList<>(values.values()); args.add(id);
        String revision = table.equals("inventory_items") ? ",revision=revision+1" : "";
        jdbc.update("UPDATE " + table + " SET " + String.join(",", values.keySet().stream().map(k -> k + "=?").toList()) + revision + " WHERE id=?", args.toArray());
    }
}
